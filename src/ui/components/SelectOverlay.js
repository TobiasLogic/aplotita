import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import { html } from '../html.js';

const WINDOW = 10;

export function SelectOverlay({ payload, onResolve }) {
  const { message, options = [], multi = false } = payload;
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState(() => new Set());

  useInput((input, key) => {
    if (key.escape) { onResolve(null); return; }
    if (key.upArrow) { setIndex((i) => (i - 1 + options.length) % options.length); return; }
    if (key.downArrow) { setIndex((i) => (i + 1) % options.length); return; }
    if (multi && input === ' ') {
      setChosen((prev) => {
        const next = new Set(prev);
        const v = options[index]?.value;
        if (next.has(v)) next.delete(v); else next.add(v);
        return next;
      });
      return;
    }
    if (key.return) {
      if (multi) onResolve(options.filter((o) => chosen.has(o.value)).map((o) => o.value));
      else onResolve(options[index]?.value ?? null);
    }
  });

  const start = Math.max(0, Math.min(index - Math.floor(WINDOW / 2), Math.max(0, options.length - WINDOW)));
  const view = options.slice(start, start + WINDOW);

  return html`<${Box} flexDirection="column" borderStyle="round" borderColor="magenta" paddingX=${1}>
    <${Text}>${chalk.bold(message)}</${Text}>
    <${Box} flexDirection="column" marginTop=${1}>
      ${view.map((o, i) => {
        const real = start + i;
        const active = real === index;
        const mark = multi ? (chosen.has(o.value) ? chalk.green('◉ ') : chalk.dim('◯ ')) : '';
        const pointer = active ? chalk.hex('#36D0D0')('❯ ') : '  ';
        const label = active ? chalk.bold.white(o.label) : chalk.white(o.label);
        const hint = o.hint ? chalk.dim(`  ${o.hint}`) : '';
        return html`<${Text} key=${o.value ?? real}>${pointer}${mark}${label}${hint}</${Text}>`;
      })}
    </${Box}>
    <${Box} marginTop=${1}>
      <${Text}>${chalk.dim(multi ? '↑↓ move · space toggle · enter confirm · esc cancel' : '↑↓ move · enter select · esc cancel')}</${Text}>
    </${Box}>
  </${Box}>`;
}
