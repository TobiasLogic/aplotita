import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import { html } from '../html.js';

const MODES = ['build', 'architect', 'ask'];
const nextMode = (m) => MODES[(MODES.indexOf(m) + 1) % MODES.length];

function withCursor(value, cursor) {
  const at = Math.max(0, Math.min(cursor, value.length));
  const ch = value[at] || ' ';
  return value.slice(0, at) + chalk.inverse(ch) + value.slice(at + 1);
}

export function Input({ mode, disabled, onSubmit, onModeChange }) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === 'd')) return;
    if (key.tab) { onModeChange(nextMode(mode)); return; }
    if (key.return) {
      const v = value;
      setValue('');
      setCursor(0);
      onSubmit(v);
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor(cursor - 1);
      }
      return;
    }
    if (key.leftArrow) { setCursor(Math.max(0, cursor - 1)); return; }
    if (key.rightArrow) { setCursor(Math.min(value.length, cursor + 1)); return; }
    if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) return;
    if (input && !key.ctrl && !key.meta) {
      const clean = input.replace(/\r/g, '');
      setValue(value.slice(0, cursor) + clean + value.slice(cursor));
      setCursor(cursor + clean.length);
    }
  }, { isActive: !disabled });

  const marker = disabled ? chalk.dim('❯') : chalk.hex('#48E080')('❯');
  const body = disabled
    ? chalk.dim('…')
    : (value.length || cursor ? withCursor(value, cursor) : chalk.inverse(' '));

  return html`<${Box} borderStyle="round" borderColor=${disabled ? 'gray' : '#36D0D0'} paddingX=${1}>
    <${Text}>${marker} ${body}</${Text}>
  </${Box}>`;
}
