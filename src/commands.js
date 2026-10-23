import chalk from 'chalk';
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';
import { runProviderSetup } from './setup.js';
import { fetchModels, modelOptions } from './models.js';
import { listSessions, saveSession, loadSession, deleteSession, isValidSessionName } from './sessions.js';
import { buildInitialMessages } from './prompt.js';
import { saveHistory, loadHistory, historyFile } from './history.js';
import { createLoader, LOADER_STYLES, exportMarkdown } from './render.js';
import { themeOptions, setTheme } from './ui/theme.js';
import {
  SPINNER_SETS, createSpinner, createShimmer, createPulse, createGradientBar, createParticles, createMatrix,
  typewriter, fadeTransition, progressBar, animateCountUp,
} from './shimmer.js';

export async function dispatchCommand(ctx, name, arg) {
  const { opts } = ctx;
  const ui = ctx.ui;

  switch (name) {
    case 'help':
      ui.help();
      break;

    case 'provider':
      await ui.suspend(() => runProviderSetup(opts));
      break;

    case 'exit':
    case 'quit':
      await ctx.goodbye();
      break;

    case 'clear':
      ui.clear();
      await ui.banner(opts);
      break;

    case 'mode': {
      if (!arg) {
        ui.log('info', `Current mode: ${ctx.mode}`);
        ui.note(chalk.dim('  Available modes: build, architect, ask'));
        break;
      }
      if (['build', 'architect', 'ask'].includes(arg)) {
        ctx.mode = arg;
        ui.setMode?.(arg);
        ui.log('success', `Mode changed to: ${chalk.bold(arg)}`);
      } else {
        ui.log('warn', `Unknown mode: ${arg}. Available: build, architect, ask`);
      }
      break;
    }

    case 'auto': {
      if (!arg) {
        ui.log('warn', 'Usage: /auto <task description>');
        break;
      }
      ui.log('info', 'Auto mode: tool use is approved automatically for this task. Destructive commands still ask first. Ctrl+C or Esc stops it.');
      ctx.autoApprove = true;
      let status;
      try {
        status = await ctx.submitPrompt(arg, { maxLoops: 100 });
      } finally {
        ctx.autoApprove = false;
      }
      if (status === 'done' && !ctx.lastTurnFailed) ui.log('success', 'Auto task completed.');
      else if (status === 'limit') ui.log('warn', 'Auto task stopped at the 100 round limit.');
      else if (ctx.lastTurnFailed) ui.log('warn', 'Auto task stopped because of an error.');
      break;
    }

    case 'reset':
      ctx.messages = buildInitialMessages(ctx.mode);
      ctx.promptMode = ctx.mode;
      ctx.alwaysAllow?.clear();
      ctx.lastUserPromptIdx = null;
      ctx.lastPromptTokens = null;
      ctx.lastPromptLen = null;
      ctx.stats.tokenUsage = { prompt: 0, completion: 0, total: 0 };
      ctx.stats.messageCount = 0;
      ctx.stats.startTime = Date.now();
      saveHistory(ctx.messages);
      ui.log('success', 'Conversation reset.');
      break;

    case 'compact': {
      const before = ctx.currentContextTokens();
      const result = await ctx.runCompaction({ force: true });
      if (result.compacted) {
        saveHistory(ctx.messages);
        ui.log('success', `Compacted conversation: ~${before} → ~${result.tokens} tokens.`);
      } else {
        ui.log('info', 'Nothing to compact yet.');
      }
      break;
    }

    case 'resume': {
      const loaded = loadHistory();
      if (loaded && loaded.length > 1) {
        ctx.messages = loaded;
        ctx.refreshSystemPrompt();
        ctx.lastUserPromptIdx = null;
        ctx.lastPromptTokens = null;
        ctx.lastPromptLen = null;
        ui.log('success', `Loaded ${loaded.length - 1} message(s) from the previous session in this project.`);
      } else {
        ui.log('warn', 'No previous session to resume.');
      }
      break;
    }

    case 'model':
      if (!arg) ui.log('info', `Model: ${opts.model}`);
      else {
        opts.model = arg;
        ui.log('success', `Model → ${chalk.bold.hex('#36D0D0')(arg)}`);
        ui.note(chalk.dim(`  (next response will use ${arg})`));
      }
      break;

    case 'models': {
      ui.setStatus('Fetching models');
      try {
        const models = await fetchModels(opts.baseUrl, opts.apiKey);
        ui.setStatus(null);
        if (models.length === 0) {
          ui.log('warn', 'No models returned.');
          break;
        }
        const options = modelOptions(models);
        const initial = options.findIndex((o) => o.value === opts.model);
        const selected = await ui.requestSelect({ message: `Select a model (${options.length} available)`, options, filterable: true, initialIndex: Math.max(0, initial) });
        if (selected == null) break;
        opts.model = selected;
        ui.log('success', `Model → ${chalk.bold.hex('#36D0D0')(selected)}`);
        ui.note(chalk.dim(`  (next response will use ${selected})`));
      } catch (err) {
        ui.setStatus(null);
        ui.log('error', `Failed to fetch models: ${err.message}`);
      }
      break;
    }

    case 'theme': {
      const selected = await ui.requestSelect({ message: 'Choose an accent', options: themeOptions() });
      if (selected == null) break;
      const t = setTheme(selected);
      ui.log('success', `Theme → ${chalk.bold.hex(t.accent)(t.label)}`);
      break;
    }

    case 'temp':
    case 'temperature': {
      if (!arg) { ui.log('info', `Temperature: ${opts.temperature ?? 'provider default'}`); break; }
      if (arg === 'default' || arg === 'off') {
        opts.temperature = null;
        ui.log('success', 'Temperature reset to the provider default.');
        break;
      }
      const n = Number(arg);
      if (isNaN(n) || n < 0 || n > 2) { ui.log('warn', 'Temperature must be between 0 and 2.'); break; }
      opts.temperature = n;
      ui.log('success', `Temperature set to ${n}`);
      break;
    }

    case 'tokens':
    case 'maxtokens': {
      if (!arg) { ui.log('info', `Max tokens: ${opts.maxTokens ?? 'provider default'}`); break; }
      if (arg === 'default' || arg === 'off') {
        opts.maxTokens = null;
        ui.log('success', 'Max output tokens reset to the provider default.');
        break;
      }
      const n = parseInt(arg, 10);
      if (isNaN(n) || n < 1) { ui.log('warn', 'Max tokens must be a positive integer.'); break; }
      opts.maxTokens = n;
      ui.log('success', `Max tokens set to ${n}`);
      break;
    }

    case 'loader': {
      const styles = ui.isInk ? Object.keys(SPINNER_SETS) : LOADER_STYLES;
      if (!arg) {
        ui.log('info', `Loader: ${chalk.bold.hex('#36D0D0')(ctx.loaderStyle)}`);
        ui.note(chalk.dim(`  Available: ${styles.join(', ')}`));
        break;
      }
      const style = arg.toLowerCase();
      if (!styles.includes(style)) {
        ui.log('warn', LOADER_STYLES.includes(style) ? `${style} only works in the classic (non-TUI) output mode.` : `Unknown loader style: ${style}`);
        ui.note(chalk.dim(`  Available: ${styles.join(', ')}`));
        break;
      }
      ctx.loaderStyle = style;
      ui.setLoader?.(style);
      ui.log('success', `Loader set to ${chalk.bold.hex('#36D0D0')(style)}`);
      if (!ui.isInk) {
        const preview = createLoader('Preview', style);
        preview.start();
        await new Promise(r => setTimeout(r, 2000));
        preview.stop();
        console.log();
      }
      break;
    }

    case 'save': {
      const file = arg || `aplotita-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
      try {
        exportMarkdown(ctx.messages, file);
        ui.log('success', `Saved conversation to ${file}`);
      } catch (err) {
        ui.log('error', `Failed to save: ${err.message}`);
      }
      break;
    }

    case 'history': {
      const count = ctx.messages.filter(m => m.role !== 'system').length;
      ui.log('info', `${count} message(s) in context. Autosaved to ${historyFile()}`);
      const window = ctx.resolveContextWindow();
      const current = ctx.currentContextTokens();
      const pct = window > 0 ? Math.round((current / window) * 100) : 0;
      const source = ctx.lastPromptTokens != null ? 'measured' : 'estimated';
      ui.note(chalk.dim(`  Context: ~${current} / ${window} tokens (${pct}% of window, ${source})`));
      if (ctx.stats.tokenUsage.total > 0) {
        ui.note(chalk.dim(`  Session tokens: ${ctx.stats.tokenUsage.prompt} prompt + ${ctx.stats.tokenUsage.completion} completion = ${ctx.stats.tokenUsage.total} total`));
      }
      break;
    }

    case 'retry':
      if (ctx.lastUserPromptIdx == null || ctx.lastUserPromptIdx >= ctx.messages.length) {
        ui.log('warn', 'Nothing to retry yet.');
        break;
      }
      ctx.messages.splice(ctx.lastUserPromptIdx + 1);
      await ctx.agentLoop({ truncateOnError: null });
      break;

    case 'allow': {
      const granted = [...(ctx.alwaysAllow || [])];
      if (arg === 'reset' || arg === 'clear') {
        ctx.alwaysAllow?.clear();
        ui.log('success', 'Cleared "always allow" approvals. Everything will ask again.');
      } else if (granted.length === 0) {
        ui.log('info', 'Nothing is auto-approved this session. Press "a" on an approval prompt to always allow that kind of action.');
      } else {
        ui.log('info', `Always allowed this session: ${granted.join(', ')}`);
        ui.note(chalk.dim('  /allow reset to ask again'));
      }
      break;
    }

    case 'sh':
      if (!arg) { ui.log('warn', 'No command provided after /sh.'); break; }
      await ctx.runShell(arg, { fromUser: true });
      break;

    case 'editor': {
      const editor = process.env.EDITOR || 'vi';
      const tmpFile = join(CONFIG_DIR, 'editor-tmp.md');
      mkdirSync(CONFIG_DIR, { recursive: true });
      writeFileSync(tmpFile, '', 'utf-8');
      ui.note(chalk.dim(`  Opening ${editor}...`));
      await ui.suspend(() => new Promise((resolve) => {
        const child = spawn(editor, [tmpFile], { stdio: 'inherit' });
        child.on('close', resolve);
      }));
      let content = '';
      try {
        content = readFileSync(tmpFile, 'utf-8').trim();
      } catch (err) {
        ui.log('error', `Failed to read editor output: ${err.message}`);
        break;
      }
      if (content) {
        ui.note(chalk.dim(`  Got ${content.length} chars from editor.`));
        await ctx.submitPrompt(content);
      } else {
        ui.log('warn', 'Editor returned empty content.');
      }
      break;
    }

    case 'session': {
      const parts = arg.split(/\s+/);
      const subCmd = (parts[0] || '').toLowerCase();
      const subArg = parts.slice(1).join(' ');

      switch (subCmd) {
        case 'list':
        case 'ls': {
          const sessions = listSessions();
          if (sessions.length === 0) {
            ui.log('info', 'No saved sessions.');
          } else {
            ui.note(chalk.bold('\n  Saved Sessions'));
            for (const s of sessions) {
              ui.note('  ' + chalk.hex('#36D0D0')(s.name) + chalk.dim(` (${s.modified.toLocaleDateString()})`));
            }
          }
          break;
        }
        case 'save': {
          if (!subArg) { ui.log('warn', 'Usage: /session save <name>'); break; }
          if (!isValidSessionName(subArg)) { ui.log('warn', 'Session names can use letters, numbers, dot, dash and underscore.'); break; }
          saveSession(subArg, ctx.messages);
          ui.log('success', `Session saved as "${subArg}"`);
          break;
        }
        case 'load': {
          if (!subArg) { ui.log('warn', 'Usage: /session load <name>'); break; }
          const loaded = loadSession(subArg);
          if (loaded) {
            ctx.messages = loaded;
            ctx.refreshSystemPrompt();
            ctx.lastUserPromptIdx = null;
            ctx.lastPromptTokens = null;
            ctx.lastPromptLen = null;
            ui.log('success', `Loaded session "${subArg}" (${loaded.length} messages)`);
          } else {
            ui.log('warn', `Session "${subArg}" not found.`);
          }
          break;
        }
        case 'delete':
        case 'rm': {
          if (!subArg) { ui.log('warn', 'Usage: /session delete <name>'); break; }
          if (deleteSession(subArg)) {
            ui.log('success', `Deleted session "${subArg}"`);
          } else {
            ui.log('warn', `Session "${subArg}" not found.`);
          }
          break;
        }
        default:
          ui.log('warn', 'Usage: /session [list|save|load|delete] [name]');
      }
      break;
    }

    case 'shimmer': {
      if (ui.isInk) {
        ui.log('info', 'Animation previews are available in the classic (non-TUI) output mode.');
        break;
      }
      const preview = createShimmer('Preview');
      preview.start();
      await new Promise(r => setTimeout(r, 2500));
      preview.stop();
      console.log(chalk.dim('  (wave bar animation)\n'));
      break;
    }

    case 'animations': {
      if (ui.isInk) {
        ui.log('info', 'Animation previews are available in the classic (non-TUI) output mode.');
        break;
      }
      console.log(chalk.bold.hex('#36D0D0')('\n  Animation Showcase\n'));

      console.log(chalk.dim('  1. Braille Spinner:'));
      const s1 = createSpinner('Processing data...', { style: 'braille', color: [54, 208, 208] });
      s1.start();
      await new Promise(r => setTimeout(r, 1500));
      s1.stop('Done processing');

      console.log(chalk.dim('  2. Dots Spinner:'));
      const s2 = createSpinner('Loading modules...', { style: 'dots', color: [180, 100, 255] });
      s2.start();
      await new Promise(r => setTimeout(r, 1500));
      s2.stop('Modules loaded');

      console.log(chalk.dim('  3. Rainbow Spinner:'));
      const s3 = createSpinner('Syncing...', { style: 'arc', rainbow: true });
      s3.start();
      await new Promise(r => setTimeout(r, 1500));
      s3.stop('Synced');

      console.log(chalk.dim('  4. Pulse Bar:'));
      const p1 = createPulse('Analyzing', { color: [255, 100, 180], width: 30 });
      p1.start();
      await new Promise(r => setTimeout(r, 1500));
      p1.stop();
      console.log();

      console.log(chalk.dim('  5. Gradient Bar:'));
      const g1 = createGradientBar('Rendering', { width: 35 });
      g1.start();
      await new Promise(r => setTimeout(r, 1500));
      g1.stop();
      console.log();

      console.log(chalk.dim('  6. Particles:'));
      const pt = createParticles('Floating', { color: [0, 255, 255], width: 32 });
      pt.start();
      await new Promise(r => setTimeout(r, 1500));
      pt.stop();
      console.log();

      console.log(chalk.dim('  7. Matrix Rain:'));
      const mx = createMatrix('Decrypting', { width: 28 });
      mx.start();
      await new Promise(r => setTimeout(r, 1500));
      mx.stop();
      console.log();

      console.log(chalk.dim('  8. Wave Bar (original):'));
      const wb = createShimmer('Classic', { width: 24 });
      wb.start();
      await new Promise(r => setTimeout(r, 1500));
      wb.stop();
      console.log();

      console.log(chalk.dim('  9. Typewriter:'));
      process.stdout.write('  ');
      await typewriter('Hello from aplótita!', { color: [54, 208, 208], bold: true, intervalMs: 40 });

      console.log(chalk.dim('  10. Fade Transition:'));
      process.stdout.write('  ');
      await fadeTransition('Fading in...', { color: [180, 100, 255], direction: 'in' });

      console.log(chalk.dim('  11. Progress Bar:'));
      process.stdout.write('  ');
      for (let i = 0; i <= 20; i++) {
        await progressBar(i, 20, { width: 25, label: 'uploading' });
        await new Promise(r => setTimeout(r, 60));
      }
      process.stdout.write('\n');

      console.log(chalk.dim('  12. Count Up:'));
      process.stdout.write('  ');
      await animateCountUp(0, 1337, { color: [72, 224, 128], prefix: 'Score: ', suffix: ' pts' });

      console.log(chalk.bold.hex('#36D0D0')('  All animations complete!\n'));
      break;
    }

    default:
      ui.log('warn', `Unknown command: /${name}. Type /help for the list.`);
      break;
  }
}
