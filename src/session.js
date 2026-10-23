import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { streamChat } from './api.js';
import { isDangerousCommand } from './executor.js';
import { diffForLineEdit, unifiedDiff } from './diff.js';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';
import { getMcpToolDefinitions, isMcpTool, executeMcpTool } from './mcp.js';
import { buildContextOutput } from './render.js';
import {
  accumulateToolCalls, assistantMessageWithToolCalls, truncateMessagesOnError,
  runAgentLoop, executeToolCalls,
} from './agent.js';
import { compactMessages } from './compaction.js';
import { estimateTokens, estimateMessagesTokens } from './tokens.js';
import { cachedContextLength } from './models.js';
import { recentUserText, getSystemPrompt, withRetrieval, warnMentions } from './prompt.js';
import { resolveMentions } from './context.js';
import { toolsForMode, modeRestriction } from './permissions.js';
import { saveHistory } from './history.js';
import { createStdoutController } from './ui/stdout-adapter.js';

export const MAX_AGENT_LOOPS = 25;
export const DEFAULT_CONTEXT_WINDOW = 128000;

function runStreamingCommand(cmd, { onStdout, onStderr, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onStdout?.(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onStderr?.(text);
    });
    child.on('error', (err) => {
      if (err.name === 'AbortError') return;
      reject(err);
    });
    child.on('close', (code, sig) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? (sig ? 1 : 0), signal: sig || null, killedByTimeout: false });
    });
  });
}

function preview(text, max = 160) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function createSession(ctx) {
  if (!ctx.ui) ctx.ui = createStdoutController(ctx);
  const ui = ctx.ui;
  if (!ctx.alwaysAllow) ctx.alwaysAllow = new Set();

  const canPrompt = () => !ctx.opts.headless;
  const autoApproving = () => Boolean(ctx.opts.headless || ctx.autoApprove);

  async function ask(kind, payload) {
    if (autoApproving() || ctx.alwaysAllow.has(kind)) return true;
    const answer = await ui.requestApproval({ ...payload, allowAlways: true });
    if (answer === 'always') {
      ctx.alwaysAllow.add(kind);
      return true;
    }
    return answer === true;
  }

  async function confirmRun(cmd, { alwaysAsk, verb = 'SHELL', kind = 'shell' } = {}) {
    const reason = isDangerousCommand(cmd);
    if (reason) {
      if (!canPrompt()) {
        return `Blocked: this looks like a ${reason}. Destructive commands never run unattended; tell the user the exact command so they can run it themselves.`;
      }
      return ui.requestApproval({ verb: 'RUN', target: cmd, hex: '#FF5555', danger: true, note: reason, message: 'Run this command anyway?', initialValue: false });
    }
    if (!alwaysAsk) return true;
    return ask(kind, { verb, target: cmd, hex: '#36D0D0', message: 'Run this command?', initialValue: true });
  }

  function editDiff(path, edits) {
    try {
      const oldContent = readFileSync(resolve(process.cwd(), path), 'utf-8');
      return edits.map((e) => diffForLineEdit(oldContent, e.start_line, e.end_line, e.content)).join('\n');
    } catch {
      return '';
    }
  }

  function writeDiff(path, content) {
    try {
      const full = resolve(process.cwd(), path);
      if (!existsSync(full)) return '';
      const before = readFileSync(full, 'utf-8');
      const after = String(content ?? '');
      const oldLines = before.split('\n').length;
      const newLines = after.split('\n').length;
      if (oldLines * newLines > 4_000_000) return `(too large to diff: ${oldLines} lines → ${newLines} lines)`;
      return unifiedDiff(before, after, { oldLabel: path, newLabel: path });
    } catch {
      return '';
    }
  }

  async function confirmToolUse(toolName, args) {
    const restriction = modeRestriction(ctx.mode, toolName, args, isMcpTool);
    if (restriction) return restriction;

    switch (toolName) {
      case 'write_file': {
        const exists = existsSync(resolve(process.cwd(), String(args.path || '')));
        return ask('write', { verb: exists ? 'OVERWRITE' : 'WRITE', target: args.path, hex: '#48E080', diff: writeDiff(args.path, args.content), message: 'Write this file?', initialValue: true });
      }
      case 'edit_file':
        return ask('write', { verb: 'EDIT', target: args.path, hex: '#E0C048', diff: editDiff(args.path, [args]), message: 'Apply this edit?', initialValue: true });
      case 'multi_edit_file': {
        const edits = Array.isArray(args.edits) ? args.edits : [];
        const n = edits.length;
        return ask('write', { verb: 'EDIT', target: args.path, hex: '#E0C048', note: `${n} edit${n === 1 ? '' : 's'}`, diff: editDiff(args.path, edits), message: 'Apply these edits?', initialValue: true });
      }
      case 'run_shell':
        return confirmRun(String(args.command || ''), { alwaysAsk: true });
      case 'spawn_background_task':
        return confirmRun(String(args.command || ''), { alwaysAsk: true, verb: 'BACKGROUND', kind: 'background' });
      case 'invoke_subagent':
        return ask('subagent', { verb: 'SUBAGENT', target: preview(args.prompt), hex: '#B464FF', note: 'runs unattended in the background', message: 'Start this subagent?', initialValue: true });
      case 'ask_question':
        if (!canPrompt()) return 'Nobody is available to answer in headless mode. Make a reasonable assumption, say what it was, and continue.';
        return true;
      case 'manage_workspace':
        if (args.action === 'list') return true;
        return ask('worktree', { verb: 'WORKTREE', target: `${args.action} ${args.path || ''}`.trim(), hex: '#E0C048', note: args.branch ? `branch ${args.branch}` : undefined, message: 'Change git worktrees?', initialValue: true });
      default:
        if (isMcpTool(toolName)) {
          return ask(`mcp:${toolName}`, { verb: 'MCP', target: toolName, hex: '#B464FF', note: preview(JSON.stringify(args), 120), message: 'Call this MCP tool?', initialValue: true });
        }
        return true;
    }
  }

  async function runShell(cmd, { fromUser, signal } = {}) {
    if (fromUser) {
      const ok = await confirmRun(cmd, { alwaysAsk: false });
      if (ok !== true) {
        ui.log('dim', '  Aborted.\n');
        return;
      }
    }

    ui.shellStart(cmd);
    if (fromUser) ctx.messages.push({ role: 'user', content: `Run shell command: ${cmd}` });

    let result;
    try {
      result = await runStreamingCommand(cmd, {
        onStdout: (t) => ui.shellChunk(t, false),
        onStderr: (t) => ui.shellChunk(t, true),
        signal,
      });
    } catch (err) {
      ui.log('error', 'Failed to start: ' + err.message);
      if (fromUser) ctx.messages.pop();
      return;
    }

    ui.shellEnd(result);

    ctx.messages.push({
      role: 'user',
      content: `Command output for "${cmd}":\n${buildContextOutput(result)}`,
    });

    if (fromUser) saveHistory(ctx.messages);
  }

  async function streamAssistant({ signal }) {
    ui.setStatus('Thinking');

    let asst = null;
    let fullResponse = '';
    let firstChunk = true;
    let toolCallFragments = [];
    let turnUsage = null;

    const allTools = toolsForMode(ctx.mode, [...TOOL_DEFINITIONS, ...getMcpToolDefinitions()], isMcpTool);
    const streamOpts = { ...ctx.opts, signal, tools: allTools, onWarning: (m) => ui.log('warn', m) };

    ctx.isStreaming = true;
    let sentLen = ctx.messages.length;
    try {
      const outgoing = withRetrieval(ctx.messages, ctx.retrievalBlock);
      sentLen = outgoing.length;
      for await (const chunk of streamChat(outgoing, streamOpts)) {
        if (chunk._type === 'usage') {
          turnUsage = chunk;
          continue;
        }

        if (chunk.toolCalls) {
          toolCallFragments = accumulateToolCalls(toolCallFragments, chunk.toolCalls);
          if (firstChunk) {
            ui.setStatus('Using tools');
            firstChunk = false;
          }
          continue;
        }

        if (chunk.content) {
          if (firstChunk) {
            ui.setStatus(null);
            asst = ui.startAssistant();
            firstChunk = false;
          }
          fullResponse += chunk.content;
          asst.appendDelta(chunk.content);
        }
      }

      if (asst) asst.done();

      if (firstChunk && toolCallFragments.length === 0) {
        ui.setStatus(null);
        ui.log('dim', '(empty response)');
      }
    } catch (err) {
      ui.setStatus(null);
      if (asst) asst.done();
      if (err.name !== 'AbortError' && !signal?.aborted) {
        ctx.lastTurnFailed = true;
        ui.log('error', err.message);
      }
      truncateMessagesOnError(ctx.messages, ctx.turnAnchor);
      saveHistory(ctx.messages);
      return;
    } finally {
      ui.setStatus(null);
      ctx.isStreaming = false;
    }

    if (turnUsage) {
      ctx.stats.tokenUsage.prompt += turnUsage.promptTokens;
      ctx.stats.tokenUsage.completion += turnUsage.completionTokens;
      ctx.stats.tokenUsage.total += turnUsage.totalTokens;
      ctx.lastPromptTokens = turnUsage.promptTokens;
      ctx.lastPromptLen = sentLen;
      if (ctx.turnTokens) {
        ctx.turnTokens.prompt += turnUsage.promptTokens;
        ctx.turnTokens.completion += turnUsage.completionTokens;
        ctx.turnTokens.total += turnUsage.totalTokens;
        ctx.turnTokens.rounds++;
      }
    }

    if (fullResponse.trim()) {
      ctx.messages.push({ role: 'assistant', content: fullResponse });
    }

    if (toolCallFragments.length > 0) {
      const toolCalls = toolCallFragments.filter(tc => tc && tc.function);
      const assistantMsg = assistantMessageWithToolCalls(fullResponse, toolCalls);

      if (!fullResponse.trim()) {
        ctx.messages.push(assistantMsg);
      } else {
        ctx.messages[ctx.messages.length - 1] = assistantMsg;
      }

      await executeToolCalls(toolCalls, {
        confirm: confirmToolUse,
        isMcpTool,
        executeMcpTool,
        executeTool,
        signal,
        onResult: (m) => ctx.messages.push(m),
        onLog: (entry) => ui.toolResult(entry),
      });

      saveHistory(ctx.messages);
      if (signal?.aborted) return;
      await runCompaction({ force: false });
      return 'continue';
    }

    await runCompaction({ force: false });
    saveHistory(ctx.messages);
  }

  async function refreshRetrieval() {
    ctx.retrievalBlock = '';
    if (!ctx.indexer) return;
    const text = recentUserText(ctx.messages, 3);
    if (!text.trim()) return;
    try {
      const block = await ctx.indexer.getContextBlock(text, { limit: 6, maxChars: 6000 });
      if (block) {
        ctx.retrievalBlock = `\n\n### Retrieved code (semantic index)\nSnippets from the project most relevant to the latest request. Use them to locate code precisely, and read full files when you need more.\n\n${block}\n`;
      }
    } catch {
      ctx.retrievalBlock = '';
    }
  }

  function resolveContextWindow() {
    const fromModel = cachedContextLength(ctx.opts.model, ctx.opts.baseUrl);
    if (fromModel && fromModel > 0) return fromModel;
    return ctx.opts.context_window || DEFAULT_CONTEXT_WINDOW;
  }

  function currentContextTokens() {
    if (ctx.lastPromptTokens != null && ctx.lastPromptLen != null && ctx.lastPromptLen <= ctx.messages.length) {
      return ctx.lastPromptTokens + estimateMessagesTokens(ctx.messages.slice(ctx.lastPromptLen));
    }
    return estimateMessagesTokens(ctx.messages) + estimateTokens(ctx.retrievalBlock);
  }

  async function summarizeMessages(evicted) {
    const summaryPrompt = [
      { role: 'system', content: 'You are a highly efficient assistant. Summarize the following conversation log concisely, capturing all important context, decisions, facts, file paths, and any open tasks. Output ONLY the summary.' },
      { role: 'user', content: JSON.stringify(evicted) },
    ];
    let summaryText = '';
    for await (const chunk of streamChat(summaryPrompt, { ...ctx.opts, tools: null, onWarning: (m) => ui.log('warn', m) })) {
      if (chunk.content) summaryText += chunk.content;
    }
    return summaryText;
  }

  function shiftIndex(idx, evicted, summarized) {
    if (idx == null) return idx;
    if (idx < 1 + evicted) return null;
    return idx - evicted + (summarized ? 1 : 0);
  }

  async function runCompaction({ force = false } = {}) {
    const window = resolveContextWindow();
    const result = await compactMessages(ctx.messages, {
      window,
      highWatermark: ctx.opts.compact_high_watermark ?? 0.75,
      lowWatermark: ctx.opts.compact_low_watermark ?? 0.5,
      force,
      currentTokens: currentContextTokens(),
      summarize: summarizeMessages,
      log: (m) => ui.log('diag', m),
    });
    if (result.compacted) {
      ctx.lastPromptTokens = null;
      ctx.lastPromptLen = null;
      const summarized = result.reason === 'summarized';
      ctx.lastUserPromptIdx = shiftIndex(ctx.lastUserPromptIdx, result.evicted, summarized);
      ctx.turnAnchor = shiftIndex(ctx.turnAnchor, result.evicted, summarized);
      if (result.reason === 'dropped') {
        ui.log('diag', `Summarization failed; dropped ${result.evicted} old message(s). (${result.error})`);
      } else {
        ui.log('diag', `Compacted ${result.evicted} message(s) into a summary. (~${result.tokens} tokens)`);
      }
    }
    return result;
  }

  function refreshSystemPrompt() {
    const content = getSystemPrompt(ctx.mode);
    if (ctx.messages[0]?.role === 'system') ctx.messages[0] = { ...ctx.messages[0], content };
    else ctx.messages.unshift({ role: 'system', content });
    ctx.promptMode = ctx.mode;
  }

  function interrupt() {
    if (!ctx.turnController) return;
    ctx.turnController.abort();
    ui.cancelPending?.();
  }

  async function agentLoop({ truncateOnError = null, maxLoops } = {}) {
    const limit = maxLoops ?? ctx.opts.max_agent_loops ?? MAX_AGENT_LOOPS;
    const controller = new AbortController();
    ctx.turnController = controller;
    ctx.turnAnchor = truncateOnError;
    ctx.lastTurnFailed = false;
    ctx.turnTokens = { prompt: 0, completion: 0, total: 0, rounds: 0 };
    ctx.isBusy = true;
    const onSigint = () => interrupt();
    process.on('SIGINT', onSigint);
    try {
      await refreshRetrieval();
      const status = await runAgentLoop(() => streamAssistant({ signal: controller.signal }), limit, controller.signal);
      if (status === 'limit') {
        ui.log('warn', `Stopped after ${limit} tool rounds. Send "continue" to let it keep going.`);
      } else if (status === 'aborted') {
        ui.log('warn', 'Interrupted.');
        saveHistory(ctx.messages);
      }
      return status;
    } finally {
      process.removeListener('SIGINT', onSigint);
      if (ctx.turnTokens?.rounds > 0) ui.usage(ctx.turnTokens);
      ctx.turnTokens = null;
      ctx.turnController = null;
      ctx.turnAnchor = null;
      ctx.isBusy = false;
    }
  }

  async function submitPrompt(rawText, { maxLoops } = {}) {
    if (ctx.promptMode !== ctx.mode) refreshSystemPrompt();
    const { text, context, images, warnings } = resolveMentions(rawText, { model: ctx.opts.model });
    warnMentions(warnings, ui);
    ui.userMessage(text);
    const body = text + context;
    const content = images.length > 0 ? [{ type: 'text', text: body }, ...images] : body;
    ctx.lastUserPromptIdx = ctx.messages.length;
    ctx.stats.messageCount++;
    ctx.messages.push({ role: 'user', content });
    return agentLoop({ truncateOnError: ctx.lastUserPromptIdx, maxLoops });
  }

  return { agentLoop, submitPrompt, runShell, runCompaction, currentContextTokens, resolveContextWindow, refreshSystemPrompt, interrupt };
}
