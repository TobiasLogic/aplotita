import * as p from '@clack/prompts';
import chalk from 'chalk';
import {
  createLoader, createStreamWriter, renderGradientSeparator,
  boxOutput, buildCommandOutput, printActionRequest, formatToolLine, formatUsage,
  printBanner, printHelp, printSessionStats, printWordmark,
} from '../render.js';

// The non-Ink UI backend: reproduces the original scrolling REPL output.
// Used for headless mode, piped/non-TTY runs, and the test harness.
export function createStdoutController(ctx = {}) {
  let loader = null;

  function stopLoader() {
    if (loader) { loader.stop(); loader = null; }
  }

  let shellCmd = null;

  const ui = {
    isInk: false,

    userMessage() {},

    note(text) {
      console.log(text);
    },

    log(level, text) {
      switch (level) {
        case 'info': p.log.info(text); break;
        case 'success': p.log.success(text); break;
        case 'warn': p.log.warn(text); break;
        case 'error': p.log.error(text); break;
        case 'message':
        case 'muted': p.log.message(text); break;
        case 'step': p.log.step(text); break;
        case 'diag': process.stderr.write(chalk.dim(`\n[aplotita] ${text}\n`)); break;
        case 'dim':
        default: console.log(chalk.dim(text)); break;
      }
    },

    usage(u) {
      console.log(chalk.dim(formatUsage(u)));
    },

    separator() {
      process.stdout.write(renderGradientSeparator() + '\n');
    },

    startAssistant() {
      const writer = createStreamWriter();
      let started = false;
      return {
        appendDelta(t) {
          if (!started) {
            process.stdout.write('\r' + renderGradientSeparator() + '\n');
            started = true;
          }
          writer(t);
        },
        done() {
          writer.end();
          if (started) process.stdout.write('\n' + renderGradientSeparator() + '\n\n');
        },
      };
    },

    setStatus(label) {
      stopLoader();
      if (label) {
        loader = createLoader(label, ctx.loaderStyle || 'braille');
        loader.start();
      }
    },

    toolResult(entry) {
      console.log(formatToolLine(entry));
    },

    shellStart(cmd) {
      shellCmd = cmd;
      console.log(chalk.dim('\n$ ') + chalk.hex('#36D0D0')(cmd) + '\n');
    },
    shellChunk(text, isErr) {
      process.stdout.write(isErr ? chalk.red(text) : text);
    },
    shellEnd(result) {
      console.log();
      boxOutput(shellCmd, buildCommandOutput(result));
      console.log();
      shellCmd = null;
    },

    async banner(opts) {
      await printBanner(opts);
    },
    help() {
      printHelp();
    },
    sessionStats(stats) {
      printSessionStats(stats);
    },
    wordmark() {
      printWordmark();
    },

    async requestApproval({ verb, target, hex, note, danger, diff, message, initialValue, allowAlways }) {
      printActionRequest({ verb, target, hex, note, danger });
      if (diff) console.log(diff);
      if (allowAlways && !danger) {
        const choice = await p.select({
          message,
          initialValue: initialValue ? 'yes' : 'no',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'always', label: 'Yes, and don\'t ask again this session' },
            { value: 'no', label: 'No' },
          ],
        });
        if (p.isCancel(choice)) return false;
        return choice === 'always' ? 'always' : choice === 'yes';
      }
      const ok = await p.confirm({ message, initialValue });
      if (p.isCancel(ok)) return false;
      return ok;
    },

    async requestSelect({ message, options, multi }) {
      const res = multi
        ? await p.multiselect({ message, options, required: false })
        : await p.select({ message, options });
      if (p.isCancel(res)) return null;
      return res;
    },

    clear() {
      console.clear();
    },

    async suspend(fn) {
      return await fn();
    },

    cancelPending() {},
  };

  return ui;
}
