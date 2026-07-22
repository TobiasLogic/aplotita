import chalk from 'chalk';
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';
import { runProviderSetup } from './setup.js';
import { resolveMentions } from './context.js';
import { fetchModels } from './models.js';
import { listSessions, saveSession, loadSession, deleteSession } from './sessions.js';
import { getSystemPrompt, buildInitialMessages, warnMentions } from './prompt.js';
import { saveHistory, loadHistory, HISTORY_FILE } from './history.js';
import { createLoader, LOADER_STYLES, exportMarkdown } from './render.js';
import {
  createSpinner, createShimmer, createPulse, createGradientBar, createParticles, createMatrix,
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
      const prevHeadless = opts.headless;
      opts.headless = true;
      ctx.messages[0].content = getSystemPrompt(ctx.mode);
      const { text, context, images, warnings } = resolveMentions(arg, { model: opts.model });
      warnMentions(warnings, ui);
      const userMsg = { role: 'user', content: context ? `${text}\n${context}` : text };
      if (images.length > 0) userMsg.content = [{ type: 'text', text: userMsg.content }, ...images];
      ctx.messages.push(userMsg);
      await ctx.agentLoop({ truncateOnError: ctx.messages.length - 1, maxLoops: 100 });
      opts.headless = prevHeadless;
      ui.log('success', 'Auto task completed.');
      break;
    }

    case 'reset':
      ctx.messages = buildInitialMessages(ctx.mode);
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
        ctx.lastUserPromptIdx = null;
        ui.log('success', `Loaded ${loaded.length - 1} message(s) from the previous session.`);
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
        const options = models.slice(0, 50).map(m => ({
          value: m.id,
          label: m.id,
          hint: m.contextLength ? `${(m.contextLength / 1000).toFixed(0)}k ctx` : '',
        }));
        const selected = await ui.requestSelect({ message: 'Select a model', options });
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

    case 'temp':
    case 'temperature': {
      if (!arg) { ui.log('info', `Temperature: ${opts.temperature}`); break; }
      const n = Number(arg);
      if (isNaN(n) || n < 0 || n > 2) { ui.log('warn', 'Temperature must be between 0 and 2.'); break; }
      opts.temperature = n;
      ui.log('success', `Temperature set to ${n}`);
      break;
    }

    case 'tokens':
    case 'maxtokens': {
      if (!arg) { ui.log('info', `Max tokens: ${opts.maxTokens}`); break; }
      const n = parseInt(arg, 10);
      if (isNaN(n) || n < 1) { ui.log('warn', 'Max tokens must be a positive integer.'); break; }
      opts.maxTokens = n;
      ui.log('success', `Max tokens set to ${n}`);
      break;
    }

    case 'loader': {
      if (!arg) {
        ui.log('info', `Loader: ${chalk.bold.hex('#36D0D0')(ctx.loaderStyle)}`);
        ui.note(chalk.dim(`  Available: ${LOADER_STYLES.join(', ')}`));
        break;
      }
      const style = arg.toLowerCase();
      if (!LOADER_STYLES.includes(style)) {
        ui.log('warn', `Unknown loader style: ${style}`);
        ui.note(chalk.dim(`  Available: ${LOADER_STYLES.join(', ')}`));
        break;
      }
      ctx.loaderStyle = style;
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
      const file = arg || `ai-cli-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
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
      ui.log('info', `${count} message(s) in context. Autosaved to ${HISTORY_FILE}`);
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
      try {
        const content = readFileSync(tmpFile, 'utf-8').trim();
        if (content) {
          ui.note(chalk.dim(`  Got ${content.length} chars from editor.`));
          ctx.lastUserPromptIdx = ctx.messages.length;
          ctx.stats.messageCount++;
          const { text: cleanText, context, images, warnings } = resolveMentions(content, { model: opts.model });
          warnMentions(warnings, ui);

          let messageContent;
          if (images && images.length > 0) {
            messageContent = [
              { type: 'text', text: cleanText + context },
              ...images
            ];
          } else {
            messageContent = cleanText + context;
          }

          ui.userMessage(cleanText);
          ctx.messages.push({ role: 'user', content: messageContent });
          await ctx.agentLoop({ truncateOnError: ctx.lastUserPromptIdx });
        } else {
          ui.log('warn', 'Editor returned empty content.');
        }
      } catch (err) {
        ui.log('error', `Failed to read editor output: ${err.message}`);
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
          saveSession(subArg, ctx.messages);
          ui.log('success', `Session saved as "${subArg}"`);
          break;
        }
        case 'load': {
          if (!subArg) { ui.log('warn', 'Usage: /session load <name>'); break; }
          const loaded = loadSession(subArg);
          if (loaded) {
            ctx.messages = loaded;
            ctx.lastUserPromptIdx = null;
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
