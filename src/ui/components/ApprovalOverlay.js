import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import { html } from '../html.js';

const MAX_DIFF_LINES = 24;

export function ApprovalOverlay({ payload, onResolve }) {
  const {
    verb, target, hex = '#36D0D0', note, diff,
    danger = false, message = 'Proceed?', initialValue = true,
  } = payload;
  const [choice, setChoice] = useState(initialValue);

  useInput((input, key) => {
    if (input === 'y' || input === 'Y') { onResolve(true); return; }
    if (input === 'n' || input === 'N') { onResolve(false); return; }
    if (key.escape) { onResolve(false); return; }
    if (key.leftArrow || key.rightArrow || key.tab) { setChoice((c) => !c); return; }
    if (key.return) { onResolve(choice); return; }
  });

  const badge = danger
    ? chalk.bold.white.bgHex(hex)(` ${verb} `)
    : chalk.bold.black.bgHex(hex)(` ${verb} `);
  const header = `${chalk.hex('#48E080')('◈')} ${chalk.dim('aplótita wants to')} ${badge}  ${chalk.bold.white(target)}${note ? chalk.dim(`  · ${note}`) : ''}`;

  let diffLines = [];
  if (diff) {
    diffLines = String(diff).split('\n');
    if (diffLines.length > MAX_DIFF_LINES) {
      const extra = diffLines.length - MAX_DIFF_LINES;
      diffLines = diffLines.slice(0, MAX_DIFF_LINES).concat(chalk.dim(`  … ${extra} more line(s)`));
    }
  }

  const yes = choice ? chalk.bold.black.bgHex('#48E080')(' Yes ') : chalk.dim(' Yes ');
  const no = !choice ? chalk.bold.white.bgHex('#FF5555')(' No ') : chalk.dim(' No ');

  return html`<${Box} flexDirection="column" borderStyle="round" borderColor=${danger ? 'red' : 'cyan'} paddingX=${1}>
    <${Text}>${header}</${Text}>
    ${diffLines.length
      ? html`<${Box} flexDirection="column" marginTop=${1}>
          ${diffLines.map((l, i) => html`<${Text} key=${i}>${l.length ? l : ' '}</${Text}>`)}
        </${Box}>`
      : null}
    <${Box} marginTop=${1}>
      <${Text}>${message}  ${yes} ${no}  ${chalk.dim('(y/n · ←→ · enter)')}</${Text}>
    </${Box}>
  </${Box}>`;
}
