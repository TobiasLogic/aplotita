import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { html } from '../html.js';
import { accent } from '../theme.js';

const FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];

export function Spinner({ label }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  const frame = chalk.bold.hex(accent())(FRAMES[i]);
  return html`<${Box}><${Text}>${'  '}${frame} ${chalk.dim(label || 'Working')}</${Text}></${Box}>`;
}
