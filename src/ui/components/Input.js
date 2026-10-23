import { useRef, useState } from 'react';
import { Box, Text, useInput, usePaste } from 'ink';
import chalk from 'chalk';
import { html } from '../html.js';
import { accent } from '../theme.js';

const MODES = ['build', 'architect', 'ask'];
const nextMode = (m) => MODES[(MODES.indexOf(m) + 1) % MODES.length];
const HISTORY_LIMIT = 100;

function normalizeNewlines(text) {
  return String(text).replace(/\r\n?/g, '\n');
}

function withCursor(value, cursor) {
  const at = Math.max(0, Math.min(cursor, value.length));
  const ch = value[at];
  if (ch === undefined) return value + chalk.inverse(' ');
  if (ch === '\n') return value.slice(0, at) + chalk.inverse(' ') + value.slice(at);
  return value.slice(0, at) + chalk.inverse(ch) + value.slice(at + 1);
}

function lineStart(value, cursor) {
  return value.lastIndexOf('\n', cursor - 1) + 1;
}

function lineEnd(value, cursor) {
  const i = value.indexOf('\n', cursor);
  return i === -1 ? value.length : i;
}

function wordStart(value, cursor) {
  let i = cursor;
  while (i > 0 && /\s/.test(value[i - 1])) i--;
  while (i > 0 && !/\s/.test(value[i - 1])) i--;
  return i;
}

export function Input({ mode, disabled, onSubmit, onModeChange }) {
  const state = useRef({ value: '', cursor: 0, history: [], historyIndex: -1, draft: '' });
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  function set(value, cursor) {
    state.current.value = value;
    state.current.cursor = Math.max(0, Math.min(cursor, value.length));
    rerender();
  }

  function insert(text) {
    const { value, cursor } = state.current;
    set(value.slice(0, cursor) + text + value.slice(cursor), cursor + text.length);
  }

  function recall(direction) {
    const s = state.current;
    if (s.history.length === 0) return;
    if (s.historyIndex === -1) {
      if (direction > 0) return;
      s.draft = s.value;
      s.historyIndex = s.history.length - 1;
    } else {
      s.historyIndex += direction;
    }
    if (s.historyIndex >= s.history.length) {
      s.historyIndex = -1;
      set(s.draft, s.draft.length);
      return;
    }
    s.historyIndex = Math.max(0, s.historyIndex);
    const entry = s.history[s.historyIndex];
    set(entry, entry.length);
  }

  function submit() {
    const s = state.current;
    const v = s.value;
    if (v.trim() && s.history[s.history.length - 1] !== v) {
      s.history.push(v);
      if (s.history.length > HISTORY_LIMIT) s.history.shift();
    }
    s.historyIndex = -1;
    s.draft = '';
    set('', 0);
    onSubmit(v);
  }

  usePaste((text) => insert(normalizeNewlines(text)), { isActive: !disabled });

  useInput((input, key) => {
    const { value, cursor } = state.current;
    if (key.ctrl && (input === 'c' || input === 'd')) return;
    if (key.tab) { onModeChange(nextMode(mode)); return; }
    if (key.return && key.meta) { insert('\n'); return; }
    if (key.return) { submit(); return; }
    if (key.backspace || key.delete) {
      if (cursor > 0) set(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
      return;
    }
    if (key.leftArrow) { set(value, cursor - 1); return; }
    if (key.rightArrow) { set(value, cursor + 1); return; }
    if (key.upArrow) { recall(-1); return; }
    if (key.downArrow) { recall(1); return; }
    if (key.home || (key.ctrl && input === 'a')) { set(value, lineStart(value, cursor)); return; }
    if (key.end || (key.ctrl && input === 'e')) { set(value, lineEnd(value, cursor)); return; }
    if (key.ctrl && input === 'u') { set(value.slice(cursor), 0); return; }
    if (key.ctrl && input === 'k') { set(value.slice(0, cursor), cursor); return; }
    if (key.ctrl && input === 'w') {
      const start = wordStart(value, cursor);
      set(value.slice(0, start) + value.slice(cursor), start);
      return;
    }
    if (key.pageUp || key.pageDown || key.escape) return;
    if (input === '\n') { insert('\n'); return; }
    if (input && !key.ctrl && !key.meta) insert(normalizeNewlines(input));
  }, { isActive: !disabled });

  const { value, cursor } = state.current;
  const marker = disabled ? chalk.dim('❯') : chalk.hex(accent())('❯');
  const body = disabled ? chalk.dim('…') : withCursor(value, cursor);

  return html`<${Box} borderStyle="round" borderColor=${disabled ? 'gray' : accent()} paddingX=${1}>
    <${Text}>${marker} ${body}</${Text}>
  </${Box}>`;
}
