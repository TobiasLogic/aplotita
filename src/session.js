import * as p from '@clack/prompts';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { streamChat } from './api.js';
import { isDangerousCommand } from './executor.js';
import { diffForLineEdit } from './diff.js';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';
import { getMcpToolDefinitions, isMcpTool, executeMcpTool } from './mcp.js';
import {
  createLoader, createStreamWriter, renderGradientSeparator,
  boxOutput, buildCommandOutput, buildContextOutput, extractShBlocks, printActionRequest,
} from './render.js';
import {
  accumulateToolCalls, assistantMessageWithToolCalls, truncateMessagesOnError,
  runAgentLoop, executeToolCalls,
} from './agent.js';
import { compactMessages } from './compaction.js';
import { estimateTokens, estimateMessagesTokens } from './tokens.js';
import { cachedContextLength } from './models.js';
import { recentUserText } from './prompt.js';
import { saveHistory } from './history.js';

export const MAX_AGENT_LOOPS = 10;
export const DEFAULT_CONTEXT_WINDOW = 128000;

function runStreamingCommand(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stdout.write(chalk.red(text));
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code || 0, signal: signal || null, killedByTimeout: false });
    });
  });
}

export function createSession(ctx) {
  async function confirmRun(cmd, { alwaysAsk }) {
    if (ctx.opts.headless) return true;
    const reason = isDangerousCommand(cmd);
    if (!alwaysAsk && !reason) return true;

    printActionRequest(reason
      ? { verb: 'RUN', target: cmd, hex: '#FF5555', danger: true, note: reason }
      : { verb: 'SHELL', target: cmd, hex: '#36D0D0' });

    const ok = await p.confirm({ message: reason ? 'Run this command anyway?' : 'Run this command?', initialValue: !reason });
    if (p.isCancel(ok)) return false;
    return ok;
  }

  async function confirmToolUse(toolName, args) {
    if (ctx.opts.headless) return true;
    if (toolName === 'write_file') {
      printActionRequest({ verb: 'WRITE', target: args.path, hex: '#48E080' });
      const ok = await p.confirm({ message: 'Write this file?', initialValue: true });
      if (p.isCancel(ok)) return false;
      return ok;
    }
    if (toolName === 'edit_file') {
      printActionRequest({ verb: 'EDIT', target: args.path, hex: '#E0C048' });
      try {
        const oldContent = readFileSync(resolve(process.cwd(), args.path), 'utf-8');
        const diff = diffForLineEdit(oldContent, args.start_line, args.end_line, args.content);
        console.log(diff);
      } catch {}
      const ok = await p.confirm({ message: 'Apply this edit?', initialValue: true });
      if (p.isCancel(ok)) return false;
      return ok;
    }
    if (toolName === 'multi_edit_file') {
      const n = args.edits?.length || 0;
      printActionRequest({ verb: 'EDIT', target: args.path, hex: '#E0C048', note: `${n} edit${n === 1 ? '' : 's'}` });
      try {
        const oldContent = readFileSync(resolve(process.cwd(), args.path), 'utf-8');
        for (const edit of args.edits || []) {
          const diff = diffForLineEdit(oldContent, edit.start_line, edit.end_line, edit.content);
          console.log(diff);
        }
      } catch {}
      const ok = await p.confirm({ message: 'Apply these edits?', initialValue: true });
      if (p.isCancel(ok)) return false;
      return ok;
    }
    if (toolName === 'run_shell') {
      return confirmRun(args.command, { alwaysAsk: true });
    }
    return true;
  }

  async function runShell(cmd, { fromUser }) {
    if (fromUser) {
      const ok = await confirmRun(cmd, { alwaysAsk: false });
      if (!ok) {
        console.log(chalk.dim('  Aborted.\n'));
        return;
      }
    }

    console.log(chalk.dim(`\n$ `) + chalk.hex('#36D0D0')(cmd) + '\n');
    if (fromUser) ctx.messages.push({ role: 'user', content: `Run shell command: ${cmd}` });

    let result;
    try {
      result = await runStreamingCommand(cmd);
    } catch (err) {
      p.log.error(chalk.red('Failed to start: ' + err.message));
      if (fromUser) ctx.messages.pop();
      return;
    }

    console.log();
    boxOutput(cmd, buildCommandOutput(result));
    console.log();

    ctx.messages.push({
      role: 'user',
      content: `Command output for "${cmd}":\n${buildContextOutput(result)}`,
    });

    if (fromUser) saveHistory(ctx.messages);
  }

  async function streamAssistant({ truncateOnError }) {
    const spinner = createLoader('Thinking', ctx.loaderStyle);
    spinner.start();

    const writer = createStreamWriter();
    let fullResponse = '';
    let firstChunk = true;
    let toolCallFragments = [];
    let turnUsage = null;

    const controller = new AbortController();
    const allTools = [...TOOL_DEFINITIONS, ...getMcpToolDefinitions()];
    const streamOpts = { ...ctx.opts, signal: controller.signal, tools: allTools };

    function onSigint() {
      controller.abort();
    }
    process.once('SIGINT', onSigint);
    ctx.isStreaming = true;

    let sentLen = ctx.messages.length;
    try {
      const outgoing = ctx.retrievalBlock && ctx.messages[0]?.role === 'system'
        ? [{ ...ctx.messages[0], content: ctx.messages[0].content + ctx.retrievalBlock }, ...ctx.messages.slice(1)]
        : ctx.messages;
      sentLen = outgoing.length;
      for await (const chunk of streamChat(outgoing, streamOpts)) {
        if (chunk._type === 'usage') {
          turnUsage = chunk;
          continue;
        }

        if (chunk.toolCalls) {
          toolCallFragments = accumulateToolCalls(toolCallFragments, chunk.toolCalls);
          if (firstChunk) {
            spinner.stop();
            if (typeof spinner.update === 'function') spinner.update('Using tools');
            spinner.start();
            firstChunk = false;
          }
          continue;
        }

        if (firstChunk) {
          spinner.stop();
          process.stdout.write('\r' + renderGradientSeparator() + '\n');
          firstChunk = false;
        }
        if (chunk.content) {
          fullResponse += chunk.content;
          writer(chunk.content);
        }
      }

      writer.end();

      if (firstChunk && toolCallFragments.length === 0) {
        spinner.stop();
        console.log(chalk.dim('(empty response)'));
      }

      if (fullResponse) {
        process.stdout.write('\n' + renderGradientSeparator() + '\n');
        console.log();
      }
    } catch (err) {
      spinner.stop();
      if (err.name === 'AbortError') {
        p.log.message(chalk.yellow('Interrupted.'));
      } else {
        p.log.error(chalk.red(err.message));
      }
      truncateMessagesOnError(ctx.messages, truncateOnError);
      return;
    } finally {
      spinner.stop();
      process.removeListener('SIGINT', onSigint);
      ctx.isStreaming = false;
    }

    if (turnUsage) {
      ctx.stats.tokenUsage.prompt += turnUsage.promptTokens;
      ctx.stats.tokenUsage.completion += turnUsage.completionTokens;
      ctx.stats.tokenUsage.total += turnUsage.totalTokens;
      ctx.lastPromptTokens = turnUsage.promptTokens;
      ctx.lastPromptLen = sentLen;
      console.log(chalk.dim(`  ${turnUsage.promptTokens} prompt · ${turnUsage.completionTokens} completion · ${turnUsage.totalTokens} total tokens`));
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
        onResult: (m) => ctx.messages.push(m),
        onLog: ({ name, result, rejected }) => {
          if (rejected) {
            console.log(chalk.dim('  ⨯ skipped\n'));
            return;
          }
          if (result.success || result.content || result.entries || result.output) {
            const summary = result.content
              ? result.content.slice(0, 200) + (result.content.length > 200 ? '...' : '')
              : result.entries
              ? result.entries.slice(0, 200)
              : result.output
              ? result.output.slice(0, 200)
              : JSON.stringify(result);
            console.log(chalk.green('  ✔ ') + chalk.bold(name) + chalk.dim(` ${summary.slice(0, 80)}`));
          } else if (result.error) {
            console.log(chalk.red('  ✗ ') + chalk.bold(name) + chalk.dim(` ${result.error}`));
          }
        },
      });

      return 'continue';
    }

    let executedSh = false;
    for (const cmd of extractShBlocks(fullResponse)) {
      const ok = await confirmRun(cmd, { alwaysAsk: true });
      if (!ok) {
        console.log(chalk.dim('  Skipped.\n'));
        continue;
      }
      await runShell(cmd, { fromUser: false });
      executedSh = true;
    }

    await runCompaction({ force: false });
    saveHistory(ctx.messages);

    if (executedSh) return 'continue';
  }

  async function refreshRetrieval() {
    ctx.retrievalBlock = '';
    if (!ctx.indexer) return;
    const text = recentUserText(ctx.messages, 3);
    if (!text.trim()) return;
    try {
      const block = await ctx.indexer.getContextBlock(text, { limit: 6, maxChars: 6000 });
      if (block) {
        ctx.retrievalBlock = `\n\n### Retrieved code (semantic index)\nSnippets from the project most relevant to the latest request — use them to locate code precisely, and read full files when you need more.\n\n${block}\n`;
      }
    } catch {
      ctx.retrievalBlock = '';
    }
  }

  function resolveContextWindow() {
    const fromModel = cachedContextLength(ctx.opts.model);
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
    for await (const chunk of streamChat(summaryPrompt, { ...ctx.opts, temperature: 0.3, tools: null })) {
      if (chunk.content) summaryText += chunk.content;
    }
    return summaryText;
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
      log: (m) => process.stderr.write(chalk.dim(`\n[aplotita] ${m}\n`)),
    });
    if (result.compacted) {
      ctx.lastPromptTokens = null;
      ctx.lastPromptLen = null;
      if (result.reason === 'dropped') {
        process.stderr.write(chalk.dim(`[aplotita] Summarization failed; dropped ${result.evicted} old message(s). (${result.error})\n`));
      } else {
        process.stderr.write(chalk.dim(`[aplotita] Compacted ${result.evicted} message(s) into a summary. (~${result.tokens} tokens)\n`));
      }
    }
    return result;
  }

  async function agentLoop({ truncateOnError, maxLoops = MAX_AGENT_LOOPS }) {
    await refreshRetrieval();
    await runAgentLoop(() => streamAssistant({ truncateOnError }), maxLoops);
  }

  return { agentLoop, runShell, runCompaction, currentContextTokens, resolveContextWindow };
}
