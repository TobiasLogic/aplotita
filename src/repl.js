import * as p from '@clack/prompts';
import { TextPrompt } from '@clack/core';
import chalk from 'chalk';
import { config, validateConfig, legacyConfigMigrated, legacyConfigSource } from './config.js';
import { fadeTransition } from './shimmer.js';
import { resolveMentions } from './context.js';
import { createPasteState, feedPasteKey, insertPaste } from './paste.js';
import { initMcpServers, cleanupMcpServers } from './mcp.js';
import { VexraIndexer } from './indexer/index.js';
import { setIndexer, getIndexer } from './indexer/instance.js';
import { getProjectConfigOverrides, getSystemPrompt, buildInitialMessages, warnMentions } from './prompt.js';
import { loadHistory } from './history.js';
import { printBanner, printSessionStats, printWordmark, promptLine } from './render.js';
import { runProviderSetup } from './setup.js';
import { createSession } from './session.js';
import { dispatchCommand } from './commands.js';

export { recentUserText } from './prompt.js';

export async function start(userOpts = {}) {
  const { resume = false, initialPrompt = '', headless = false, ...optOverrides } = userOpts;
  const projectOverrides = getProjectConfigOverrides();
  const opts = { ...config, ...projectOverrides, ...optOverrides };
  if (headless) opts.headless = true;

  if (!opts.apiKey && opts.provider !== 'ollama') {
    if (opts.headless) {
      console.error('Error: Headless mode requires an API key or Ollama provider.');
      process.exit(1);
    }
    await runProviderSetup(opts);
  }

  validateConfig(opts);

  const ctx = {
    opts,
    messages: buildInitialMessages('build'),
    mode: 'build',
    indexer: null,
    retrievalBlock: '',
    lastPromptTokens: null,
    lastPromptLen: null,
    lastUserPromptIdx: null,
    isStreaming: false,
    loaderStyle: 'braille',
    stats: { tokenUsage: { prompt: 0, completion: 0, total: 0 }, startTime: Date.now(), messageCount: 0 },
  };
  Object.assign(ctx, createSession(ctx));

  async function goodbye() {
    if (process.stdout.isTTY) process.stdout.write('\x1b[?2004l');
    printSessionStats(ctx.stats);
    console.log();
    printWordmark();
    console.log();
    cleanupMcpServers();
    getIndexer()?.close();
    await fadeTransition('  until next time', { color: [180, 100, 255], direction: 'out' });
    process.exit(0);
  }
  ctx.goodbye = goodbye;

  process.on('SIGINT', async () => {
    if (ctx.isStreaming) return;
    if (process.stdout.isTTY) process.stdout.write('\x1b[?2004l');
    printSessionStats(ctx.stats);
    cleanupMcpServers();
    if (ctx.indexer) ctx.indexer.close();
    process.stdout.write('\x1b[?25h');
    process.exit(0);
  });

  await printBanner(opts);
  if (legacyConfigMigrated && !opts.headless) {
    p.log.warn(`Migrated your settings from ${legacyConfigSource} to ~/.aplotita. The old directory was left in place and can be deleted once everything looks right.`);
  }
  await initMcpServers(p);

  if (config.indexer?.enabled && !opts.headless) {
    try {
      ctx.indexer = new VexraIndexer({
        root: process.cwd(),
        log: (m) => { if (!ctx.isStreaming) p.log.message(chalk.dim(m)); },
      }).init();
      setIndexer(ctx.indexer);
      ctx.indexer.startWatch();
      ctx.indexer.index()
        .then((stats) => {
          if (ctx.isStreaming) return;
          const mode = stats.vecEnabled && stats.embedded ? 'semantic' : 'keyword';
          p.log.message(chalk.dim(`index ready · ${stats.files} files · ${stats.chunks} chunks · ${mode} search`));
        })
        .catch(() => {});
    } catch {
      ctx.indexer = null;
    }
  }

  if (resume) {
    const loaded = loadHistory();
    if (loaded && loaded.length > 1) {
      ctx.messages = loaded;
      p.log.success(`Resumed previous session (${loaded.length - 1} message(s)).`);
    } else {
      p.log.warn('No previous session to resume - starting fresh.');
    }
  }

  if (initialPrompt) {
    ctx.messages[0].content = getSystemPrompt(ctx.mode);
    const { text, context, images, warnings } = resolveMentions(initialPrompt, { model: opts.model });
    warnMentions(warnings);
    const userMsg = { role: 'user', content: context ? `${text}\n${context}` : text };
    if (images.length > 0) userMsg.content = [{ type: 'text', text: userMsg.content }, ...images];
    ctx.messages.push(userMsg);
    await ctx.agentLoop({ truncateOnError: ctx.messages.length - 1 });
    if (opts.headless) {
      printSessionStats(ctx.stats);
      cleanupMcpServers();
      process.exit(0);
    }
  }

  if (opts.headless) {
    console.error('Error: Headless mode requires an initial prompt.');
    process.exit(1);
  }

  if (process.stdout.isTTY) process.stdout.write('\x1b[?2004h');

  while (true) {
    ctx.messages[0].content = getSystemPrompt(ctx.mode);

    const modes = ['build', 'architect', 'ask'];
    const inputPrompt = new TextPrompt({
      render() {
        if (this.value === undefined) this.value = '';
        return promptLine(ctx.mode) + '\n' + chalk.hex('#48E080')('❯') + ' ' + this.valueWithCursor;
      }
    });

    inputPrompt.on('key', (key) => {
      if (key === '\t') {
        const idx = modes.indexOf(ctx.mode);
        ctx.mode = modes[(idx + 1) % modes.length];
      }
    });

    const pasteState = createPasteState();
    let pasteAnchor = { line: '', cursor: 0 };
    const baseOnKeypress = inputPrompt.onKeypress;
    inputPrompt.onKeypress = (str, key) => {
      const ev = feedPasteKey(pasteState, str, key);
      if (ev.type === 'start') {
        const rl = inputPrompt.rl;
        pasteAnchor = { line: rl?.line ?? '', cursor: rl?.cursor ?? 0 };
        return;
      }
      if (ev.type === 'accumulate') return;
      if (ev.type === 'end') {
        const rl = inputPrompt.rl;
        const { line, cursor } = insertPaste(pasteAnchor.line, pasteAnchor.cursor, ev.text);
        if (rl) { rl.line = line; rl.cursor = cursor; }
        inputPrompt.value = line.replace(/\t/g, '');
        inputPrompt._cursor = cursor;
        inputPrompt.render();
        return;
      }
      return baseOnKeypress(str, key);
    };

    const input = await inputPrompt.prompt();

    if (p.isCancel(input)) await goodbye();

    const trimmed = (input || '').trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('/')) {
      const space = trimmed.indexOf(' ');
      const name = (space === -1 ? trimmed.slice(1) : trimmed.slice(1, space)).toLowerCase();
      const arg = space === -1 ? '' : trimmed.slice(space + 1).trim();
      await dispatchCommand(ctx, name, arg);
      continue;
    }

    ctx.lastUserPromptIdx = ctx.messages.length;
    ctx.stats.messageCount++;
    const { text: cleanText, context, images, warnings } = resolveMentions(trimmed, { model: opts.model });
    warnMentions(warnings);

    let messageContent;
    if (images && images.length > 0) {
      messageContent = [
        { type: 'text', text: cleanText + context },
        ...images
      ];
    } else {
      messageContent = cleanText + context;
    }

    ctx.messages.push({ role: 'user', content: messageContent });
    await ctx.agentLoop({ truncateOnError: ctx.lastUserPromptIdx });
  }
}
