import { Box, Text } from 'ink';
import chalk from 'chalk';
import { html } from '../html.js';
import { inlineWordmark } from '../../render.js';

const CHIP = { architect: '#FF5555', ask: '#5555FF', build: '#36D0D0' };

export function StatusBar({ ctx, mode }) {
  const chipColor = CHIP[mode] || CHIP.build;
  const chip = chalk.bold.black.bgHex(chipColor)(` ${mode.toUpperCase()} `);
  const model = chalk.dim(ctx.opts.model);
  const total = ctx.stats?.tokenUsage?.total || 0;
  const tokens = chalk.dim(`${total} tok`);
  const hint = chalk.dim('Tab: mode · /help · ^C exit');
  return html`<${Box}>
    <${Text}>${'  '}${inlineWordmark('aplótita')}  ${chip}  ${model} ${chalk.dim('·')} ${tokens} ${chalk.dim('·')} ${hint}</${Text}>
  </${Box}>`;
}
