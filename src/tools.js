import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'fs';
import { resolve, relative, join, sep } from 'path';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { fileURLToPath } from 'url';
import { runCommand, runCommandArgs, spawnBackgroundTask, spawnBackgroundTaskArgs, BACKGROUND_TASKS, killTree } from './executor.js';
import { invalidateCodeMap } from './codemap.js';
import { getIndexer } from './indexer/instance.js';
import { createStdoutController } from './ui/stdout-adapter.js';

let _ui = null;
export function setToolUI(ui) { _ui = ui; }
function toolUI() { return _ui || (_ui = createStdoutController()); }

const MAX_READ_SIZE = 100 * 1024;
const MAX_OUTPUT_SIZE = 50 * 1024;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const DEFAULT_SHELL_TIMEOUT_S = 120;
const MAX_SHELL_TIMEOUT_S = 600;

// Keep the semantic index fresh after an agent edit. Fire-and-forget: indexing
// must never block or fail a tool call. The hash check inside updateFile dedupes
// against the file-watcher firing on the same change.
function refreshIndex(fullPath) {
  const indexer = getIndexer();
  if (indexer) Promise.resolve(indexer.updateFile(fullPath)).catch(() => {});
}

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the given path. Returns the file content as text.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative or absolute)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative or absolute)' },
          content: { type: 'string', description: 'The content to write to the file' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edit a file by replacing a specific line range with new content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative or absolute)' },
          start_line: { type: 'number', description: '1-indexed start line (inclusive)' },
          end_line: { type: 'number', description: '1-indexed end line (inclusive)' },
          content: { type: 'string', description: 'The replacement content string' },
        },
        required: ['path', 'start_line', 'end_line', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'multi_edit_file',
      description: 'Edit a file by replacing several non-overlapping line ranges in one call. Line numbers refer to the file before any of the edits are applied.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative or absolute)' },
          edits: {
            type: 'array',
            description: 'Edits to apply. Ranges must not overlap; they can be given in any order.',
            items: {
              type: 'object',
              properties: {
                start_line: { type: 'number', description: '1-indexed start line (inclusive)' },
                end_line: { type: 'number', description: '1-indexed end line (inclusive)' },
                content: { type: 'string', description: 'The replacement content string' }
              },
              required: ['start_line', 'end_line', 'content']
            }
          }
        },
        required: ['path', 'edits'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the contents of a directory. Returns file and directory names with type indicators.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (relative or absolute). Defaults to cwd.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Execute a shell command and return its output. Use for builds, tests, git operations, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          timeout_seconds: { type: 'number', description: `Optional timeout in seconds (default ${DEFAULT_SHELL_TIMEOUT_S}, max ${MAX_SHELL_TIMEOUT_S})` },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_background_task',
      description: 'Spawn a background shell task. Returns a task ID to interact with it later.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute in the background' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_task',
      description: 'Manage background tasks. Actions: list, status, kill.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'status', 'kill'], description: 'The action to perform' },
          task_id: { type: 'string', description: 'Task ID (required for status or kill)' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'invoke_subagent',
      description: 'Invokes a subagent (an autonomous copy of the AI) to work on a task in the background. Returns a conversation ID that you can track via manage_task.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'A clear, actionable task description for the subagent.' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_workspace',
      description: 'Manage Git worktrees to create isolated parallel branches for experimenting without breaking main files.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'remove'], description: 'Action to perform' },
          path: { type: 'string', description: 'Relative path for the new worktree (for create) or path to remove (for remove)' },
          branch: { type: 'string', description: 'Branch name for the new worktree (for create)' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_question',
      description: 'Ask the user a multiple-choice question to clarify intent or get design feedback. Halts execution until the user responds in the terminal.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: 'The question to ask' },
                options: { type: 'array', items: { type: 'string' }, description: 'Array of string options' },
                is_multi_select: { type: 'boolean', description: 'If true, user can select multiple options' }
              },
              required: ['question', 'options']
            }
          }
        },
        required: ['questions']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch the text content of a webpage via its URL. Useful for reading documentation or looking up error messages.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full URL to fetch (e.g., https://example.com)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Run git status and return the working tree status.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Run git diff to see unstaged changes.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Search file contents for a regular expression using ripgrep (falls back to git grep or grep). Respects .gitignore when ripgrep or git is available.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The search pattern' },
          path: { type: 'string', description: 'Directory to search in (default: cwd)' },
        },
        required: ['pattern'],
      },
    },
  },
];

function resolvePath(p) {
  return resolve(process.cwd(), p);
}

function isInsideCwd(fullPath) {
  const root = resolve(process.cwd());
  return fullPath === root || fullPath.startsWith(root + sep);
}

function truncateOutput(text, maxLen = MAX_OUTPUT_SIZE) {
  if (text.length <= maxLen) return text;
  const startLen = Math.floor(maxLen * 0.2);
  const endLen = maxLen - startLen;
  return text.slice(0, startLen) + `\n\n... [truncated, ${text.length - maxLen} chars omitted] ...\n\n` + text.slice(-endLen);
}

async function checkSyntax(fullPath) {
  if (/\.(m|c)?js$/.test(fullPath)) {
    try {
      const result = await runCommandArgs(process.execPath, ['--check', fullPath]);
      if (result.exitCode !== 0) return `The file was saved, but node --check reports a syntax error:\n${result.stderr}`;
    } catch {}
  }
  return null;
}

function afterWrite(fullPath) {
  invalidateCodeMap();
  refreshIndex(fullPath);
}

function isLineNumber(n) {
  return Number.isInteger(n) && n >= 0;
}

export function planLineEdits(lineCount, edits) {
  if (!Array.isArray(edits) || edits.length === 0) return { error: 'edits must be a non-empty array' };
  for (const e of edits) {
    if (!e || typeof e.content !== 'string' || !isLineNumber(e.start_line) || !isLineNumber(e.end_line)) {
      return { error: 'Each edit needs integer start_line and end_line and a string content' };
    }
    const start = e.start_line - 1;
    if (start < 0 || start > lineCount || e.end_line < start || e.end_line > lineCount) {
      return { error: `Invalid line range: ${e.start_line} to ${e.end_line} (file has ${lineCount} lines)` };
    }
  }
  const sorted = [...edits].sort((a, b) => a.start_line - b.start_line);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.start_line <= prev.end_line || cur.start_line === prev.start_line) {
      return { error: `Edits overlap: lines ${prev.start_line}-${prev.end_line} and ${cur.start_line}-${cur.end_line}. Merge them into one edit.` };
    }
  }
  return { ordered: sorted.reverse() };
}

function applyLineEdits(lines, ordered) {
  let replaced = 0;
  let added = 0;
  for (const edit of ordered) {
    const start = edit.start_line - 1;
    const newLines = edit.content.split('\n');
    if (newLines[newLines.length - 1] === '') newLines.pop();
    lines.splice(start, edit.end_line - start, ...newLines);
    replaced += edit.end_line - start;
    added += newLines.length;
  }
  return { replaced, added };
}

async function execReadFile(args) {
  const fullPath = resolvePath(args.path);
  if (!isInsideCwd(fullPath)) {
    return { error: `Refusing to read outside the project directory: ${args.path}. Use run_shell if you really need this.` };
  }
  if (!existsSync(fullPath)) return { error: `File not found: ${args.path}` };
  try {
    const stat = statSync(fullPath);
    if (stat.size > MAX_READ_SIZE) {
      const content = readFileSync(fullPath, 'utf-8').slice(0, MAX_READ_SIZE);
      return { content: content + `\n... [truncated at ${MAX_READ_SIZE} bytes, total ${stat.size}]` };
    }
    return { content: readFileSync(fullPath, 'utf-8') };
  } catch (err) {
    return { error: `Failed to read ${args.path}: ${err.message}` };
  }
}

async function execWriteFile(args) {
  const fullPath = resolvePath(args.path);
  if (!isInsideCwd(fullPath)) {
    return { error: `Refusing to write outside the project directory: ${args.path}. Use run_shell if you really need this.` };
  }
  if (typeof args.content !== 'string') return { error: 'content must be a string' };
  try {
    writeFileSync(fullPath, args.content, 'utf-8');
    afterWrite(fullPath);
    const warning = await checkSyntax(fullPath);
    return { success: true, path: args.path, bytes: Buffer.byteLength(args.content), ...(warning ? { warning } : {}) };
  } catch (err) {
    return { error: `Failed to write ${args.path}: ${err.message}` };
  }
}

async function execEditFile(args) {
  const fullPath = resolvePath(args.path);
  if (!isInsideCwd(fullPath)) {
    return { error: `Refusing to write outside the project directory: ${args.path}. Use run_shell if you really need this.` };
  }
  if (!existsSync(fullPath)) return { error: `File not found: ${args.path}` };
  try {
    const lines = readFileSync(fullPath, 'utf-8').split('\n');
    const plan = planLineEdits(lines.length, [{ start_line: args.start_line, end_line: args.end_line, content: args.content }]);
    if (plan.error) return { error: plan.error };
    const { replaced, added } = applyLineEdits(lines, plan.ordered);
    writeFileSync(fullPath, lines.join('\n'), 'utf-8');
    afterWrite(fullPath);
    const warning = await checkSyntax(fullPath);
    return { success: true, path: args.path, linesReplaced: replaced, linesAdded: added, ...(warning ? { warning } : {}) };
  } catch (err) {
    return { error: `Failed to edit ${args.path}: ${err.message}` };
  }
}

async function execMultiEditFile(args) {
  const fullPath = resolvePath(args.path);
  if (!isInsideCwd(fullPath)) {
    return { error: `Refusing to write outside the project directory: ${args.path}. Use run_shell if you really need this.` };
  }
  if (!existsSync(fullPath)) return { error: `File not found: ${args.path}` };
  try {
    const lines = readFileSync(fullPath, 'utf-8').split('\n');
    const plan = planLineEdits(lines.length, args.edits);
    if (plan.error) return { error: plan.error };
    const { replaced, added } = applyLineEdits(lines, plan.ordered);
    writeFileSync(fullPath, lines.join('\n'), 'utf-8');
    afterWrite(fullPath);
    const warning = await checkSyntax(fullPath);
    return { success: true, path: args.path, editsApplied: plan.ordered.length, linesReplaced: replaced, linesAdded: added, ...(warning ? { warning } : {}) };
  } catch (err) {
    return { error: `Failed to multi-edit ${args.path}: ${err.message}` };
  }
}

async function execListDir(args) {
  const dirPath = resolvePath(args.path || '.');
  if (!isInsideCwd(dirPath)) {
    return { error: `Refusing to list outside the project directory: ${args.path || '.'}. Use run_shell if you really need this.` };
  }
  if (!existsSync(dirPath)) return { error: `Directory not found: ${args.path || '.'}` };
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const lines = entries.map(e => {
      const type = e.isDirectory() ? 'dir ' : 'file';
      return `${type}  ${e.name}`;
    });
    return { entries: lines.join('\n') || '(empty directory)' };
  } catch (err) {
    return { error: `Failed to list ${args.path || '.'}: ${err.message}` };
  }
}

function shellTimeoutMs(seconds) {
  const n = Number(seconds);
  const s = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_SHELL_TIMEOUT_S) : DEFAULT_SHELL_TIMEOUT_S;
  return Math.round(s * 1000);
}

async function execRunShell(args, { signal } = {}) {
  const timeout = shellTimeoutMs(args.timeout_seconds);
  try {
    const result = await runCommand(args.command, { timeout, signal });
    invalidateCodeMap();
    let output = '';
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? '\n' : '') + `[stderr] ${result.stderr}`;
    if (result.killedByTimeout) output += `\n[timed out after ${timeout / 1000}s; pass a larger timeout_seconds or use spawn_background_task]`;
    else if (result.exitCode !== 0) output += `\n[exit code: ${result.exitCode}]`;
    return { output: truncateOutput(output || '(no output)') };
  } catch (err) {
    if (err.name === 'AbortError') return { error: 'Interrupted by the user.' };
    return { error: `Command failed: ${err.message}` };
  }
}

async function execSpawnBackgroundTask(args) {
  try {
    const id = spawnBackgroundTask(args.command);
    return { success: true, task_id: id, message: `Task started in background: ${args.command}` };
  } catch (err) {
    return { error: `Failed to spawn task: ${err.message}` };
  }
}

async function execManageTask(args) {
  if (args.action === 'list') {
    if (BACKGROUND_TASKS.size === 0) return { output: 'No background tasks.' };
    let out = '';
    for (const [id, task] of BACKGROUND_TASKS.entries()) {
      out += `[${id}] ${task.status} (pid: ${task.pid}) - ${task.cmd}\n`;
    }
    return { output: out.trim() };
  }
  
  if (!args.task_id) return { error: `task_id is required for action '${args.action}'` };
  const task = BACKGROUND_TASKS.get(args.task_id);
  if (!task) return { error: `Task not found: ${args.task_id}` };

  if (args.action === 'status') {
    return {
      task_id: task.id,
      cmd: task.cmd,
      status: task.status,
      exitCode: task.exitCode,
      stdout: truncateOutput(task.stdout, 5000),
      stderr: truncateOutput(task.stderr, 5000),
    };
  }
  
  if (args.action === 'kill') {
    if (task.status === 'running') {
      killTree(task.child);
      task.status = 'killed';
      return { success: true, message: `Sent kill signal to task ${task.id}` };
    }
    return { error: `Task ${task.id} is already ${task.status}` };
  }
  
  return { error: `Unknown action: ${args.action}` };
}

async function execInvokeSubagent(args) {
  try {
    const cliPath = fileURLToPath(new URL('../cli.js', import.meta.url));
    const id = spawnBackgroundTaskArgs('node', [cliPath, '--headless', args.prompt]);
    return { success: true, conversation_id: id, message: `Subagent spawned as task ${id}. Use manage_task status to check its output.` };
  } catch (err) {
    return { error: `Failed to invoke subagent: ${err.message}` };
  }
}

function gitFailure(res) {
  return { error: `git worktree failed: ${res.stderr || res.stdout || `exit code ${res.exitCode}`}` };
}

async function execManageWorkspace(args) {
  try {
    if (args.action === 'create') {
      if (typeof args.path !== 'string' || typeof args.branch !== 'string' || !args.path || !args.branch) {
        return { error: 'path and branch are required for create' };
      }
      if (args.path.startsWith('-') || args.branch.startsWith('-')) return { error: 'path and branch must not start with "-"' };
      const res = await runCommandArgs('git', ['worktree', 'add', '-b', args.branch, '--', args.path]);
      if (res.exitCode !== 0) return gitFailure(res);
      return { success: true, message: `Created new worktree at ${args.path} on branch ${args.branch}` };
    }
    if (args.action === 'list') {
      const res = await runCommandArgs('git', ['worktree', 'list']);
      if (res.exitCode !== 0) return gitFailure(res);
      return { output: res.stdout };
    }
    if (args.action === 'remove') {
      if (typeof args.path !== 'string' || !args.path) return { error: 'path is required for remove' };
      if (args.path.startsWith('-')) return { error: 'path must not start with "-"' };
      const res = await runCommandArgs('git', ['worktree', 'remove', '--', args.path]);
      if (res.exitCode !== 0) return gitFailure(res);
      return { success: true, message: `Removed worktree at ${args.path}` };
    }
    return { error: `Unknown action: ${args.action}` };
  } catch (err) {
    return { error: `git worktree failed: ${err.message}` };
  }
}

async function execAskQuestion(args) {
  const ui = toolUI();
  try {
    const answers = [];
    for (const q of args.questions) {
      const options = q.options.map(opt => ({ value: opt, label: opt }));
      const selected = await ui.requestSelect({ message: q.question, options, multi: !!q.is_multi_select });
      if (selected == null) return { error: 'User cancelled the question.' };
      answers.push({ question: q.question, answer: selected });
    }
    return { success: true, answers };
  } catch (err) {
    return { error: `Failed to ask question: ${err.message}` };
  }
}

export function isBlockedHost(hostname) {
  let host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const mapped = host.match(/^::ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    host = hex
      ? [parseInt(hex[1], 16) >> 8, parseInt(hex[1], 16) & 255, parseInt(hex[2], 16) >> 8, parseInt(hex[2], 16) & 255].join('.')
      : tail;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '::') return true;
  if (host === 'metadata.google.internal') return true;
  if (/^0\./.test(host)) return true;
  if (/^127\./.test(host)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(host)) return true;
  if (/^fe80:/.test(host)) return true;
  return false;
}

async function assertPublicHost(hostname) {
  const blocked = () => {
    const e = new Error('refusing to fetch a private, loopback, or link-local address');
    e.blocked = true;
    return e;
  };
  if (isBlockedHost(hostname)) throw blocked();
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return;
  let addresses;
  try {
    addresses = await lookup(bare, { all: true });
  } catch {
    return;
  }
  if (addresses.some((a) => isBlockedHost(a.address))) throw blocked();
}

async function readCapped(res, limit) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= limit) {
      try { await reader.cancel(); } catch {}
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, limit));
}

async function fetchFollow(startUrl, headers, maxHops = 5) {
  let url = startUrl;
  for (let hop = 0; hop < maxHops; hop++) {
    await assertPublicHost(url.hostname);
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      url = new URL(loc, url);
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

async function execWebFetch(args) {
  let url;
  try {
    url = new URL(args.url);
  } catch {
    return { error: `Invalid URL: ${args.url}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Only http and https URLs are supported.' };
  }
  try {
    const res = await fetchFollow(url, { 'User-Agent': 'aplotita (+https://github.com/TobiasLogic/aplotita)' });
    if (!res.ok) return { error: `HTTP ${res.status}: ${res.statusText}` };
    const contentType = res.headers.get('content-type') || '';
    const raw = await readCapped(res, MAX_FETCH_BYTES);
    if (/html|xml/.test(contentType)) {
      try {
        const { load } = await import('cheerio');
        const $ = load(raw);
        $('script, style, noscript, svg, head').remove();
        const text = $('body').length ? $('body').text() : $.root().text();
        const cleaned = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
        return { content: truncateOutput(cleaned) };
      } catch {
        return { content: truncateOutput(raw) };
      }
    }
    return { content: truncateOutput(raw) };
  } catch (err) {
    return { error: `Fetch failed: ${err.message}` };
  }
}

async function execGitStatus(args) {
  try {
    const result = await runCommand('git status -s');
    return { output: truncateOutput(result.stdout || '(no changes)') };
  } catch (err) {
    return { error: `git status failed: ${err.message}` };
  }
}

async function execGitDiff(args) {
  try {
    const result = await runCommand('git diff');
    return { output: truncateOutput(result.stdout || '(no unstaged changes)') };
  } catch (err) {
    return { error: `git diff failed: ${err.message}` };
  }
}

async function execGrepSearch(args) {
  const pattern = args.pattern;
  if (typeof pattern !== 'string' || pattern === '') {
    return { error: 'pattern is required' };
  }
  const dir = resolvePath(args.path || '.');
  if (!isInsideCwd(dir)) {
    return { error: `Refusing to search outside the project directory: ${args.path}. Use run_shell if you really need this.` };
  }
  const target = relative(process.cwd(), dir) || '.';
  const attempts = [
    ['rg', ['-n', '--no-heading', '--color', 'never', '-e', pattern, '--', target]],
    ['git', ['grep', '-n', '-I', '-E', '-e', pattern, '--', target]],
    ['grep', ['-rnIE', '--exclude-dir=node_modules', '--exclude-dir=.git', '-e', pattern, '--', target]],
  ];
  for (const [file, argv] of attempts) {
    try {
      const result = await runCommandArgs(file, argv);
      if (result.exitCode === 0) return { output: truncateOutput(result.stdout || '(no matches found)') };
      if (result.exitCode === 1) return { output: '(no matches found)' };
    } catch {
      continue;
    }
  }
  return { output: '(no matches found)' };
}

const EXECUTORS = {
  read_file: execReadFile,
  write_file: execWriteFile,
  edit_file: execEditFile,
  multi_edit_file: execMultiEditFile,
  list_dir: execListDir,
  run_shell: execRunShell,
  spawn_background_task: execSpawnBackgroundTask,
  manage_task: execManageTask,
  invoke_subagent: execInvokeSubagent,
  manage_workspace: execManageWorkspace,
  ask_question: execAskQuestion,
  web_fetch: execWebFetch,
  git_status: execGitStatus,
  git_diff: execGitDiff,
  grep_search: execGrepSearch,
};

export async function executeTool(name, args, opts = {}) {
  const executor = EXECUTORS[name];
  if (!executor) return { error: `Unknown tool: ${name}` };
  return executor(args || {}, opts);
}

export function getToolNames() {
  return Object.keys(EXECUTORS);
}
