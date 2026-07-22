#!/usr/bin/env node
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error('Error: aplotita requires Node.js 22 or higher (current: %s).', process.version);
  process.exit(1);
}

import { program } from 'commander';
import { start } from './src/repl.js';

program
  .name('aplotita')
  .description('aplotita - the simple terminal AI coding assistant (multi-provider)')
  .argument('[prompt]', 'Optional initial prompt (for headless mode)')
  .option('-m, --model <name>', 'Model ID')
  .option('-t, --temperature <n>', 'Temperature (0-2)', parseFloat)
  .option('--max-tokens <n>', 'Max output tokens', parseInt)
  .option('-c, --continue', 'Resume the previous saved session')
  .option('--headless', 'Run in headless mode (no prompts, auto-approve)')
  .parse();

const opts = program.opts();
const args = program.args;

const overrides = {};
if (opts.model) overrides.model = opts.model;
if (opts.temperature !== undefined) overrides.temperature = opts.temperature;
if (opts.maxTokens !== undefined) overrides.maxTokens = opts.maxTokens;
if (opts.continue) overrides.resume = true;
if (opts.headless) overrides.headless = true;
if (args[0]) overrides.initialPrompt = args[0];

start(overrides);
