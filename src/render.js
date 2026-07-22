import chalk from 'chalk';
import boxen from 'boxen';
import { highlight } from 'cli-highlight';
import { writeFileSync } from 'fs';
import {
  createShimmer, createSpinner, createPulse, createParticles, createMatrix,
} from './shimmer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  function handleLine(line) {
    const fence = line.match(/^\s*```(.*)$/);
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

function gradientRgb(t) {
  return [
    Math.round(54 + (180 - 54) * t),
    Math.round(208 + (100 - 208) * t),
    Math.round(208 + (255 - 208) * t),
  ];
}

function styleWordmarkLine(line, sweep) {
  const w = Math.max(line.length, 1);
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ' ') { out += ' '; continue; }
    const t = i / w;
    let [r, g, b] = gradientRgb(t);
    if (sweep != null) {
      const boost = Math.max(0, 1 - Math.abs(t - sweep) * 6);
      r = Math.min(255, Math.round(r + (255 - r) * boost));
      g = Math.min(255, Math.round(g + (255 - g) * boost));
      b = Math.min(255, Math.round(b + (255 - b) * boost));
    }
    out += chalk.rgb(r, g, b)(ch);
  }
  return out;
}

function wordmarkFrame(sweep) {
  return WORDMARK.map((l) => '  ' + styleWordmarkLine(l, sweep)).join('\n');
}

export function printWordmark() {
  console.log(wordmarkFrame(null));
}

async function animateWordmark({ frames = 16, intervalMs = 55 } = {}) {
  if (!process.stdout.isTTY) { printWordmark(); return; }
  process.stdout.write('\x1b[?25l');
  for (let f = 0; f <= frames; f++) {
    const sweep = -0.2 + (1.4 * f) / frames;
    if (f > 0) process.stdout.write('\x1b[3A');
    process.stdout.write('\r' + wordmarkFrame(sweep) + '\n');
    await sleep(intervalMs);
  }
  process.stdout.write('\x1b[?25h');
}

export function inlineWordmark(text = 'aplótita') {
  const chars = [...text];
  const w = Math.max(chars.length, 1);
  return chars.map((ch, i) => {
    const [r, g, b] = gradientRgb(i / w);
    return chalk.bold.rgb(r, g, b)(ch);
  }).join('');
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
  console.log('  ' + chalk.gray(`temp ${opts.temperature}   max tokens ${opts.maxTokens}`));
  console.log('  ' + chalk.gray('type ') + chalk.hex('#36D0D0')('/help') + chalk.gray(' for commands · Ctrl+C to exit'));
  console.log();
}
