import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { html } from '../html.js';
import { accent } from '../theme.js';
import { SPINNER_SETS } from '../../shimmer.js';

export function Spinner({ label, style = 'braille' }) {
  const frames = SPINNER_SETS[style] || SPINNER_SETS.braille;
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => x + 1), 80);
    return () => clearInterval(t);
  }, []);
  const frame = chalk.bold.hex(accent())(frames[i % frames.length]);
  return html`<${Box}><${Text}>${'  '}${frame} ${chalk.dim(label || 'Working')}</${Text}></${Box}>`;
}
