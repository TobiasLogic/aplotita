import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import { html } from '../html.js';

const WINDOW = 10;

export function filterOptions(options, query) {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const terms = q.split(/\s+/);
  return options.filter((o) => {
    const hay = `${o.label} ${o.value} ${o.hint || ''}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function SelectOverlay({ payload, onResolve }) {
  const { message, options = [], multi = false, initialIndex = 0 } = payload;
  const filterable = !multi && (payload.filterable || options.length > WINDOW);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, options.length - 1)));
  const [chosen, setChosen] = useState(() => new Set());

  const visible = filterable ? filterOptions(options, query) : options;
  const current = Math.min(index, Math.max(0, visible.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      if (filterable && query) { setQuery(''); setIndex(0); return; }
      onResolve(null);
      return;
    }
    if (key.upArrow) { setIndex(() => (current - 1 + visible.length) % Math.max(1, visible.length)); return; }
    if (key.downArrow) { setIndex(() => (current + 1) % Math.max(1, visible.length)); return; }
    if (key.pageUp) { setIndex(() => Math.max(0, current - WINDOW)); return; }
    if (key.pageDown) { setIndex(() => Math.min(Math.max(0, visible.length - 1), current + WINDOW)); return; }
    if (multi && input === ' ') {
      setChosen((prev) => {
        const next = new Set(prev);
        const v = visible[current]?.value;
        if (next.has(v)) next.delete(v); else next.add(v);
        return next;
      });
      return;
    }
    if (key.return) {
      if (multi) onResolve(options.filter((o) => chosen.has(o.value)).map((o) => o.value));
      else onResolve(visible[current]?.value ?? null);
      return;
    }
    if (!filterable) return;
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setIndex(0);
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.tab) {
      setQuery((q) => q + input);
      setIndex(0);
    }
  });

  const start = Math.max(0, Math.min(current - Math.floor(WINDOW / 2), Math.max(0, visible.length - WINDOW)));
  const view = visible.slice(start, start + WINDOW);
  const help = multi
    ? '↑↓ move · space toggle · enter confirm · esc cancel'
    : filterable
      ? 'type to filter · ↑↓ move · enter select · esc cancel'
      : '↑↓ move · enter select · esc cancel';

  return html`<${Box} flexDirection="column" borderStyle="round" borderColor="magenta" paddingX=${1}>
    <${Text}>${chalk.bold(message)}</${Text}>
    ${filterable
      ? html`<${Text}>${chalk.dim('filter ')}${query ? chalk.white(query) : chalk.dim('(type to search)')}${chalk.dim(`  ${visible.length}/${options.length}`)}</${Text}>`
      : null}
    <${Box} flexDirection="column" marginTop=${1}>
      ${view.length === 0
        ? html`<${Text}>${chalk.dim('  no matches')}</${Text}>`
        : view.map((o, i) => {
          const real = start + i;
          const active = real === current;
          const mark = multi ? (chosen.has(o.value) ? chalk.green('◉ ') : chalk.dim('◯ ')) : '';
          const pointer = active ? chalk.hex('#36D0D0')('❯ ') : '  ';
          const label = active ? chalk.bold.white(o.label) : chalk.white(o.label);
          const hint = o.hint ? chalk.dim(`  ${o.hint}`) : '';
          return html`<${Text} key=${o.value ?? real}>${pointer}${mark}${label}${hint}</${Text}>`;
        })}
    </${Box}>
    <${Box} marginTop=${1}>
      <${Text}>${chalk.dim(help)}</${Text}>
    </${Box}>
  </${Box}>`;
}
