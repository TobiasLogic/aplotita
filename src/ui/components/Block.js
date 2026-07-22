import { Box, Text } from 'ink';
import chalk from 'chalk';
import { html } from '../html.js';
import {
  renderMarkdownToString, renderGradientSeparator, formatHelp,
  buildCommandOutput, inlineWordmark,
} from '../../render.js';

const LOG_STYLE = {
  info: (t) => chalk.cyan('  ℹ ') + t,
  success: (t) => chalk.green('  ✔ ') + t,
  warn: (t) => chalk.yellow('  ▲ ') + t,
  error: (t) => chalk.red('  ■ ') + chalk.red(t),
  message: (t) => chalk.dim('  │ ') + t,
  muted: (t) => chalk.dim('  │ ') + chalk.dim(t),
  step: (t) => chalk.green('  ◆ ') + t,
  diag: (t) => chalk.dim(`  ${t}`),
  dim: (t) => chalk.dim(t),
};

function toolLine({ name, result = {}, rejected }) {
  if (rejected) return chalk.dim('  ⨯ skipped');
  if (result.success || result.content || result.entries || result.output) {
    const summary = result.content
      ? result.content.slice(0, 200)
      : result.entries ? String(result.entries).slice(0, 200)
      : result.output ? String(result.output).slice(0, 200)
      : '';
    return chalk.green('  ✔ ') + chalk.bold(name) + chalk.dim(` ${summary.slice(0, 80)}`);
  }
  if (result.error) return chalk.red('  ✗ ') + chalk.bold(name) + chalk.dim(` ${result.error}`);
  return chalk.green('  ✔ ') + chalk.bold(name);
}

function bannerLines(opts = {}) {
  return [
    '',
    '  ' + inlineWordmark('aplótita') + '  ' + chalk.dim('the simple terminal AI coding assistant'),
    '  ' + chalk.gray('model ') + chalk.white(opts.model || '') +
      chalk.gray(`    temp ${opts.temperature}   max ${opts.maxTokens}`),
    '  ' + chalk.gray('type ') + chalk.hex('#36D0D0')('/help') + chalk.gray(' for commands · ^C to exit'),
    '',
  ];
}

function Lines({ text, dim }) {
  const lines = String(text ?? '').split('\n');
  return html`<${Box} flexDirection="column">
    ${lines.map((l, i) => html`<${Text} key=${i} dimColor=${!!dim}>${l.length ? l : ' '}</${Text}>`)}
  </${Box}>`;
}

export function Block({ block }) {
  switch (block.type) {
    case 'user':
      return html`<${Box}><${Text}>${chalk.hex('#48E080')('❯')} ${chalk.white(block.text)}</${Text}></${Box}>`;

    case 'assistant':
      return html`<${Box} flexDirection="column">
        <${Text}>${chalk.dim(renderGradientSeparator())}</${Text}>
        <${Lines} text=${renderMarkdownToString(block.text || '')} />
      </${Box}>`;

    case 'note':
      return html`<${Lines} text=${block.text} />`;

    case 'log': {
      const fn = LOG_STYLE[block.level] || LOG_STYLE.message;
      return html`<${Lines} text=${fn(block.text)} />`;
    }

    case 'usage':
      return html`<${Box}><${Text}>${chalk.dim(`  ${block.prompt} prompt · ${block.completion} completion · ${block.total} total tokens`)}</${Text}></${Box}>`;

    case 'separator':
      return html`<${Box}><${Text}>${chalk.dim(renderGradientSeparator())}</${Text}></${Box}>`;

    case 'tool':
      return html`<${Box}><${Text}>${toolLine(block)}</${Text}></${Box}>`;

    case 'shell':
      return html`<${Box} flexDirection="column">
        <${Text}>${chalk.dim('$ ')}${chalk.hex('#36D0D0')(block.cmd)}</${Text}>
        ${block.done
          ? html`<${Box} borderStyle="round" borderColor="cyan" paddingX=${1} flexDirection="column">
              <${Lines} text=${buildCommandOutput(block.result || {})} />
            </${Box}>`
          : html`<${Lines} text=${(block.out || '').replace(/\n$/, '')} dim=${block.hasErr} />`}
      </${Box}>`;

    case 'banner':
      return html`<${Lines} text=${bannerLines(block.opts).join('\n')} />`;

    case 'help':
      return html`<${Lines} text=${formatHelp()} />`;

    case 'wordmark':
      return html`<${Box}><${Text}>${'  '}${inlineWordmark('aplótita')}</${Text}></${Box}>`;

    default:
      return null;
  }
}
