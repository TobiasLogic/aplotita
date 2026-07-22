import chalk from 'chalk';
import boxen from 'boxen';
import { highlight } from 'cli-highlight';
import { writeFileSync } from 'fs';
import {
  shimmerText, createShimmer, createSpinner, createPulse, createParticles, createMatrix,
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

export function extractShBlocks(text) {
  const regex = /```(?:sh|bash|shell|zsh)\r?\n([\s\S]*?)\r?\n```/g;
  const blocks = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
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

function formatFencedBlock(code, lang) {
  const highlighted = highlightCode(code.trimEnd(), lang);
  return `\n${highlighted}\n`;
}

function renderMarkdownInline(text) {
  let out = text;
  out = out.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
  out = out.replace(/__(.+?)__/g, (_, t) => chalk.bold(t));
  out = out.replace(/`([^`]+)`/g, (_, t) => chalk.cyan(t));
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => chalk.underline.blue(text) + chalk.dim(`(${url})`));
  return out;
}

export function createStreamWriter() {
  let state = 'text';
  let blockLang = '';
  let blockBuf = '';

  function flushBlock() {
    if (!blockBuf) return;
    process.stdout.write(formatFencedBlock(blockBuf.trimEnd(), blockLang));
    blockBuf = '';
    blockLang = '';
  }

  return function write(raw) {
    let text = raw;

    while (text.length > 0) {
      if (state === 'text') {
        const idx = text.indexOf('```');
        if (idx === -1) {
          process.stdout.write(renderMarkdownInline(text));
          return;
        }

        process.stdout.write(renderMarkdownInline(text.slice(0, idx)));
        text = text.slice(idx + 3);
        const nl = text.indexOf('\n');

        if (nl === -1) {
          state = 'maybe-language';
          blockBuf = text;
          text = '';
        } else {
          blockLang = text.slice(0, nl).trim();
          text = text.slice(nl + 1);
          state = 'block';
        }
      } else if (state === 'maybe-language') {
        const nl = text.indexOf('\n');
        if (nl === -1) {
          blockBuf += text;
          text = '';
        } else if (blockBuf.trim() === '' && text.slice(0, nl).trim() === '') {
          blockLang = '';
          text = text.slice(nl + 1);
          state = 'block';
        } else {
          process.stdout.write('```' + blockBuf);
          blockBuf = '';
          state = 'text';
        }
      } else if (state === 'block') {
        blockBuf += text;
        text = '';

        const marker = '\n```';
        const idx = blockBuf.indexOf(marker);

        if (idx === -1) return;

        const code = blockBuf.slice(0, idx);
        let after = blockBuf.slice(idx + marker.length);

        blockBuf = code;
        flushBlock();

        blockLang = '';

        if (after.startsWith('\r')) after = after.slice(1);
        if (after.startsWith('\n')) after = after.slice(1);

        state = 'text';
        if (after) text = after;
      }
    }
  };
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

export function renderGradientSeparator(width = 58) {
  let out = '';
  for (let i = 0; i < width; i++) {
    const t = i / width;
    const r = Math.round(54 + (180 - 54) * Math.sin(t * Math.PI));
    const g = Math.round(208 + (100 - 208) * Math.sin(t * Math.PI));
    const b = Math.round(208 + (255 - 208) * Math.sin(t * Math.PI));
    out += chalk.rgb(r, g, b)('─');
  }
  return out;
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
  ['/temp [n]', 'Show or set temperature (0-2)'],
  ['/tokens [n]', 'Show or set max output tokens'],
  ['/mode [type]', 'Switch role: build, architect, ask'],
  ['/auto <prompt>', 'Run an autonomous agent loop'],
  ['/loader [style]', 'Show or set loader animation (braille, dots, arc, pulse, shimmer, ...)'],
  ['/save [file]', 'Export the conversation to a markdown file'],
  ['/retry', 'Regenerate the last response'],
  ['/reset', 'Clear the conversation and start fresh'],
  ['/compact', 'Summarize older history to free up context'],
  ['/resume', 'Reload the previous saved session'],
  ['/session <cmd>', 'Named sessions: list, save <name>, load <name>, delete <name>'],
  ['/editor', 'Open $EDITOR for multi-line input'],
  ['/history', 'Show conversation stats & token usage'],
  ['/clear', 'Clear the screen'],
  ['/animations', 'Preview all animation styles'],
  ['/shimmer', 'Preview the wave bar animation'],
  ['/exit', 'Quit (or press Ctrl+C)'],
];

export function printHelp() {
  console.log();
  console.log('  ' + chalk.bold('Commands'));
  for (const [c, d] of COMMANDS) {
    console.log('  ' + chalk.hex('#36D0D0')(c.padEnd(20)) + chalk.gray(d));
  }
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

export async function printBanner(opts) {
  const cols = Math.min(process.stdout.columns || 60, 60);
  const innerW = cols - 2;
  console.log();
  console.log(chalk.dim('╭' + '─'.repeat(innerW) + '╮'));
  await shimmerText('aplótita', {
    prefix: chalk.dim('│') + '  ',
    suffix: chalk.dim(' - TUI AI Assistant'),
  });
  console.log(
    chalk.dim('│') +
    '  ' + chalk.gray(`Model: ${opts.model}`)
  );
  console.log(
    chalk.dim('│') +
    '  ' + chalk.gray(`Temp: ${opts.temperature}   Max tokens: ${opts.maxTokens}`)
  );
  console.log(
    chalk.dim('│') +
    '  ' + chalk.gray('Type ') + chalk.hex('#36D0D0')('/help') +
    chalk.gray(' for commands  ·  Ctrl+C to exit')
  );
  console.log(chalk.dim('╰' + '─'.repeat(innerW) + '╯'));
  console.log();
}
