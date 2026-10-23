import chalk from 'chalk';
import boxen from 'boxen';
import { highlight } from 'cli-highlight';
import { writeFileSync } from 'fs';
import {
  createShimmer, createSpinner, createPulse, createParticles, createMatrix,
} from './shimmer.js';

export const LOADER_STYLES = ['braille', 'dots', 'arc', 'circle', 'square', 'line', 'grow', 'shimmer', 'pulse', 'particles', 'matrix'];

export function createLoader(label, style) {
  switch (style) {
    case 'shimmer': return createShimmer(label);
    case 'pulse': return createPulse(label, { color: [72, 224, 128] });
    case 'particles': return createParticles(label, { color: [0, 255, 255] });
    case 'matrix': return createMatrix(label);
    default: return createSpinner(label, { style: style || 'braille', color: [54, 208, 208] });
  }
}

const HL_THEME = {
  keyword:      chalk.blue,
  string:       chalk.green,
  number:       chalk.yellow,
  comment:      chalk.dim,
  default:      chalk.white,
  function:     chalk.magenta,
  class:        chalk.cyan,
  title:        chalk.bold,
  params:       chalk.italic,
  regexp:       chalk.red,
  built_in:     chalk.blueBright,
  type:         chalk.cyan,
  literal:      chalk.yellow,
  meta:         chalk.dim,
  tag:          chalk.blue,
  attr:         chalk.yellow,
  attribute:    chalk.yellow,
  doctag:       chalk.cyan,
  name:         chalk.white,
  selector:     chalk.magenta,
  symbol:       chalk.yellow,
  section:      chalk.bold,
  quote:        chalk.dim,
  template:     chalk.green,
  variable:     chalk.yellow,
  link:         chalk.cyan,
  emphasis:     chalk.italic,
  strong:       chalk.bold,
};

const LANG_MAP = {
  sh: 'bash', bash: 'bash', zsh: 'bash', shell: 'bash',
  js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
  yml: 'yaml', md: 'markdown',
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function visibleLength(text) {
  return [...String(text).replace(ANSI_RE, '')].length;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_CELL = /^:?-+:?$/;

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

export function renderTable(lines) {
  const rows = lines.map(splitTableRow);
  const sepIdx = rows.findIndex((r) => r.length > 0 && r.every((c) => TABLE_SEPARATOR_CELL.test(c)));
  const align = sepIdx >= 0 ? rows[sepIdx].map((c) => (c.endsWith(':') && !c.startsWith(':') ? 'right' : 'left')) : [];
  const hasHeader = sepIdx === 1;
  const cols = Math.max(...rows.map((r) => r.length));
  const cells = rows
    .filter((_, i) => i !== sepIdx)
    .map((r, i) => Array.from({ length: cols }, (_, c) => {
      const text = renderInline(r[c] ?? '');
      return hasHeader && i === 0 ? chalk.bold(text) : text;
    }));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(...cells.map((r) => visibleLength(r[c]))));
  const pad = (text, width, side) => {
    const gap = ' '.repeat(Math.max(0, width - visibleLength(text)));
    return side === 'right' ? gap + text : text + gap;
  };
  const line = (r) => ('  ' + r.map((c, i) => pad(c, widths[i], align[i])).join('   ')).replace(/\s+$/, '');
  const out = cells.map(line);
  if (hasHeader) out.splice(1, 0, chalk.dim('  ' + widths.map((w) => '─'.repeat(w)).join('   ')));
  return out.join('\n') + '\n';
}

function oneLine(text, max = 70) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function lastLine(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

function countLines(text) {
  return String(text ?? '').split('\n').filter((l) => l.trim()).length;
}

function toolTarget(name, args = {}) {
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return args.path;
    case 'multi_edit_file':
      return `${args.path} (${Array.isArray(args.edits) ? args.edits.length : 0} edits)`;
    case 'list_dir':
      return args.path || '.';
    case 'run_shell':
    case 'spawn_background_task':
      return `$ ${args.command ?? ''}`;
    case 'grep_search':
      return `${args.pattern ?? ''}${args.path ? ` in ${args.path}` : ''}`;
    case 'web_fetch':
      return args.url;
    case 'invoke_subagent':
      return args.prompt;
    case 'manage_task':
    case 'manage_workspace':
      return [args.action, args.task_id, args.path, args.branch].filter(Boolean).join(' ');
    case 'ask_question':
      return Array.isArray(args.questions) ? args.questions.map((q) => q?.question).join(' / ') : '';
    case 'git_status':
    case 'git_diff':
      return '';
    default:
      return args && Object.keys(args).length ? JSON.stringify(args) : '';
  }
}

function toolOutcome(name, result = {}) {
  switch (name) {
    case 'ask_question':
      return Array.isArray(result.answers)
        ? '→ ' + result.answers.map((a) => (Array.isArray(a.answer) ? a.answer.join(', ') : a.answer)).join(' / ')
        : '';
    case 'write_file':
      return result.bytes != null ? `${result.bytes} bytes` : '';
    case 'edit_file':
    case 'multi_edit_file':
      return result.linesAdded != null ? `-${result.linesReplaced} +${result.linesAdded} lines` : '';
    case 'read_file':
      return typeof result.content === 'string' ? `${result.content.split('\n').length} lines` : '';
    case 'list_dir':
    case 'grep_search':
    case 'git_status':
    case 'git_diff': {
      const text = String(result.output ?? result.entries ?? '');
      return /^\(no /.test(text) ? text : `${countLines(text)} lines`;
    }
    case 'spawn_background_task':
      return result.task_id || '';
    case 'invoke_subagent':
      return result.conversation_id || '';
    case 'web_fetch':
      return typeof result.content === 'string' ? `${result.content.length} chars` : '';
    default:
      return lastLine(result.output ?? result.content ?? result.entries ?? result.message ?? '');
  }
}

export function formatToolLine({ name, args, result = {}, rejected, reason }) {
  const target = oneLine(toolTarget(name, args || {}), 60);
  const label = name + (target ? ' ' + target : '');
  if (rejected) {
    return chalk.dim(`  ⨯ ${label} · ${reason ? `blocked: ${oneLine(reason, 90)}` : 'skipped'}`);
  }
  const head = chalk.bold(name) + (target ? ' ' + chalk.white(target) : '');
  if (result.error) return chalk.red('  ✗ ') + head + chalk.dim(' · ' + oneLine(result.error, 90));
  const outcome = oneLine(toolOutcome(name, result), 60);
  const nonZero = /\[(exit code: \d+|timed out)/.test(String(result.output || ''));
  const mark = nonZero ? chalk.yellow('  ▲ ') : chalk.green('  ✔ ');
  const warn = result.warning ? chalk.yellow('  ▲ saved with a syntax error') : '';
  return mark + head + (outcome ? chalk.dim(' · ' + outcome) : '') + warn;
}

function compactNumber(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

export function formatUsage({ prompt = 0, completion = 0, rounds = 1 }) {
  const parts = [];
  if (rounds > 1) parts.push(`${rounds} requests`);
  parts.push(`${compactNumber(prompt)} in`, `${compactNumber(completion)} out`);
  return '  ' + parts.join(' · ');
}

function highlightCode(code, lang) {
  const mapped = LANG_MAP[lang] || lang || undefined;
  try {
    return highlight(code, { language: mapped, theme: HL_THEME });
  } catch {
    try {
      return highlight(code, { theme: HL_THEME });
    } catch {
      return chalk.white(code);
    }
  }
}

function frameWidth() {
  return Math.max(24, Math.min((process.stdout.columns || 80) - 2, 72));
}

function formatFencedBlock(code, lang) {
  const width = frameWidth();
  const label = (lang || 'code').toLowerCase();
  const dashes = '─'.repeat(Math.max(1, width - label.length - 4));
  const header = chalk.dim('  ╭─ ') + chalk.hex('#36D0D0')(label) + chalk.dim(` ${dashes}`);
  const footer = chalk.dim('  ╰' + '─'.repeat(width - 1));
  const highlighted = highlightCode(code.replace(/\s+$/, ''), lang);
  const body = highlighted.split('\n').map((l) => chalk.dim('  │ ') + l).join('\n');
  return `\n${header}\n${body}\n${footer}\n`;
}

function renderInline(text) {
  let out = text;
  out = out.replace(/`([^`]+)`/g, (_, t) => chalk.hex('#9EE6E6')(t));
  out = out.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
  out = out.replace(/__(.+?)__/g, (_, t) => chalk.bold(t));
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => chalk.underline.blue(label) + chalk.dim(`(${url})`));
  return out;
}

export function renderMarkdownLine(line) {
  if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
    return chalk.dim('  ' + '─'.repeat(frameWidth() - 2));
  }
  const heading = line.match(/^(#{1,6})\s+(.*)$/);
  if (heading) {
    const level = heading[1].length;
    const text = renderInline(heading[2]);
    if (level === 1) return '\n' + chalk.bold.underline.hex('#36D0D0')(text);
    if (level === 2) return chalk.bold.hex('#48E080')('▍ ') + chalk.bold.hex('#48E080')(text);
    return chalk.bold.hex('#B478FF')(text);
  }
  const quote = line.match(/^\s*>\s?(.*)$/);
  if (quote) return chalk.dim('  ▏ ') + chalk.italic.dim(renderInline(quote[1]));
  const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
  if (bullet) return `${bullet[1]}  ${chalk.hex('#36D0D0')('•')} ${renderInline(bullet[2])}`;
  const numbered = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (numbered) return `${numbered[1]}  ${chalk.hex('#36D0D0')(numbered[2] + '.')} ${renderInline(numbered[3])}`;
  return renderInline(line);
}

export function createStreamWriter(sink) {
  const out = sink || ((s) => process.stdout.write(s));
  let buffer = '';
  let inCode = false;
  let codeLang = '';
  let codeLines = [];
  let tableLines = [];

  function flushTable() {
    if (tableLines.length === 0) return;
    out(renderTable(tableLines));
    tableLines = [];
  }

  function handleLine(line) {
    const fence = line.match(/^\s*```(.*)$/);
    if (!inCode && !fence && TABLE_ROW.test(line)) {
      tableLines.push(line);
      return;
    }
    flushTable();
    if (inCode) {
      if (fence) {
        out(formatFencedBlock(codeLines.join('\n'), codeLang));
        inCode = false;
        codeLang = '';
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      return;
    }
    if (fence) {
      inCode = true;
      codeLang = fence[1].trim();
      codeLines = [];
      return;
    }
    out(renderMarkdownLine(line) + '\n');
  }

  function write(raw) {
    buffer += raw;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      handleLine(line);
    }
  }

  write.end = () => {
    if (buffer.length > 0) {
      const last = buffer.replace(/\r$/, '');
      buffer = '';
      if (inCode) codeLines.push(last);
      else handleLine(last);
    }
    flushTable();
    if (inCode) {
      out(formatFencedBlock(codeLines.join('\n'), codeLang));
      inCode = false;
      codeLines = [];
    }
  };

  return write;
}

export function renderMarkdownToString(text) {
  let out = '';
  const w = createStreamWriter((s) => { out += s; });
  w(text);
  w.end();
  return out.replace(/\n$/, '');
}

export function boxOutput(label, content) {
  if (!content) return;
  const boxed = boxen(content, {
    padding: { top: 0, bottom: 0, left: 2, right: 1 },
    margin: 0,
    borderStyle: 'round',
    borderColor: 'cyan',
    dimBorder: true,
    title: label,
    titleAlignment: 'left',
  });
  console.log(boxed);
}

export function buildCommandOutput(result) {
  let parts = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(chalk.red(result.stderr));
  if (result.killedByTimeout) {
    parts.push(chalk.yellow(`Timed out (exit code ${result.exitCode})`));
  } else if (result.exitCode !== 0 && !result.stderr) {
    parts.push(chalk.yellow(`Exit code: ${result.exitCode}`));
  }
  return parts.length ? parts.join('\n') : '(no output)';
}

export function buildContextOutput(result) {
  let output = '';
  if (result.stdout) output += `stdout:\n${result.stdout}\n`;
  if (result.stderr) output += `stderr:\n${result.stderr}\n`;
  if (result.killedByTimeout) {
    output += `Timed out. Exit code: ${result.exitCode}\n`;
  } else if (result.exitCode !== 0 && !result.stderr) {
    output += `Exit code: ${result.exitCode}\n`;
  }
  return output.trim() || '(no output)';
}

export function printActionRequest({ verb, target, hex, note, danger = false }) {
  const badge = danger
    ? chalk.bold.white.bgHex(hex)(` ${verb} `)
    : chalk.bold.black.bgHex(hex)(` ${verb} `);
  const mark = chalk.hex('#48E080')('◈');
  let line = `\n  ${mark} ${chalk.dim('aplótita wants to')} ${badge}  ${chalk.bold.white(target)}`;
  if (note) line += chalk.dim(`  · ${note}`);
  console.log(line);
}

export function renderGradientSeparator(width = 58) {
  return chalk.dim('─'.repeat(width));
}

export function exportMarkdown(messages, file) {
  const lines = ['# aplótita conversation', '', `Exported ${new Date().toISOString()}`, ''];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    lines.push(m.role === 'user' ? '## You' : '## Assistant', '', content, '');
  }
  writeFileSync(file, lines.join('\n'), 'utf-8');
}

export const COMMANDS = [
  ['/help', 'Show this help'],
  ['/sh <cmd>', 'Run a shell command directly'],
  ['/provider', 'Set up provider, API key, and model'],
  ['/model [id]', 'Show or switch the model'],
  ['/models', 'Browse and pick models interactively'],
  ['/temp [n|default]', 'Show or set temperature (0-2)'],
  ['/tokens [n|default]', 'Show or set max output tokens'],
  ['/mode [type]', 'Switch role: build, architect, ask'],
  ['/theme', 'Pick an accent color'],
  ['/auto <prompt>', 'Run an autonomous agent loop'],
  ['/loader [style]', 'Show or set the spinner (braille, dots, arc, circle, line, ...)'],
  ['/save [file]', 'Export the conversation to a markdown file'],
  ['/retry', 'Regenerate the last response'],
  ['/allow [reset]', 'Show or clear "always allow" approvals for this session'],
  ['/reset', 'Clear the conversation and start fresh'],
  ['/compact', 'Summarize older history to free up context'],
  ['/resume', 'Reload the previous saved session'],
  ['/session <cmd>', 'Named sessions: list, save <name>, load <name>, delete <name>'],
  ['/editor', 'Open $EDITOR for multi-line input'],
  ['/history', 'Show conversation stats & token usage'],
  ['/clear', 'Clear the screen'],
  ['/animations', 'Preview all animation styles'],
  ['/shimmer', 'Preview the wave bar animation'],
  ['/exit', 'Quit (or press Ctrl+C when idle)'],
];

export function formatHelp() {
  const lines = ['', '  ' + chalk.bold('Commands')];
  for (const [c, d] of COMMANDS) {
    lines.push('  ' + chalk.hex('#36D0D0')(c.padEnd(20)) + chalk.gray(d));
  }
  return lines.join('\n');
}

export function printHelp() {
  console.log(formatHelp());
  console.log();
}

export function printSessionStats(stats) {
  const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  console.log();
  console.log(chalk.bold.hex('#36D0D0')('  Session Stats'));
  console.log(chalk.dim('  ─────────────────────────────'));
  console.log('  ' + chalk.gray('Duration:  ') + chalk.white(timeStr));
  console.log('  ' + chalk.gray('Messages:  ') + chalk.white(`${stats.messageCount}`));
  if (stats.tokenUsage.total > 0) {
    console.log('  ' + chalk.gray('Tokens:    ') + chalk.white(`${stats.tokenUsage.total}`) +
      chalk.dim(` (${stats.tokenUsage.prompt} prompt + ${stats.tokenUsage.completion} completion)`));
  }
  console.log(chalk.dim('  ─────────────────────────────'));
  console.log();
}

const WORDMARK = [
  '╔═╗  ╔═╗  ╦    ╔═╗  ╔╦╗  ╦  ╔╦╗  ╔═╗',
  '╠═╣  ╠═╝  ║    ║ ║   ║   ║   ║   ╠═╣',
  '╩ ╩  ╩    ╩═╝  ╚═╝   ╩   ╩   ╩   ╩ ╩',
];

function wordmarkFrame() {
  return WORDMARK.map((l) => '  ' + chalk.bold.gray(l)).join('\n');
}

export function printWordmark() {
  console.log(wordmarkFrame());
}

async function animateWordmark() {
  printWordmark();
}

export function inlineWordmark(text = 'aplótita') {
  return chalk.bold.gray(text);
}

export function promptLine(mode) {
  const chipColor = mode === 'architect' ? '#FF5555' : mode === 'ask' ? '#5555FF' : '#36D0D0';
  const chip = chalk.bold.black.bgHex(chipColor)(` ${mode.toUpperCase()} `);
  return `${chalk.hex('#48E080')('◇')} ${inlineWordmark('aplótita')}  ${chip}${chalk.dim('  Tab: mode · /help')}`;
}

export async function printBanner(opts) {
  console.log();
  await animateWordmark();
  console.log('  ' + chalk.dim('the simple terminal AI coding assistant'));
  console.log();
  console.log('  ' + chalk.gray('model  ') + chalk.white(opts.model));
  console.log('  ' + chalk.gray(`temp ${opts.temperature ?? 'default'}   max tokens ${opts.maxTokens ?? 'default'}`));
  console.log('  ' + chalk.gray('type ') + chalk.hex('#36D0D0')('/help') + chalk.gray(' for commands · Ctrl+C to exit'));
  console.log();
}
