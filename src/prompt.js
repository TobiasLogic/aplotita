import * as p from '@clack/prompts';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { generateCodeMap } from './codemap.js';

export function findProjectConfig() {
  const candidates = ['AGENTS.md', '.ai-cli.md', '.ai-cli.json'];
  let dir = process.cwd();
  const root = resolve('/');
  while (dir !== root) {
    for (const name of candidates) {
      const full = join(dir, name);
      if (existsSync(full)) return { path: full, dir, name };
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function getSystemPrompt(mode = 'build') {
  let modePrompt = '';
  if (mode === 'architect') {
    modePrompt = `You are a senior software architect running in the user's terminal. Your job is to analyze the codebase, plan system designs, and propose architecture changes. Do NOT write functional code or modify implementation details directly. Focus on markdown documents, architectural diagrams, and high-level strategy.`;
  } else if (mode === 'ask') {
    modePrompt = `You are a senior mentor running in the user's terminal. The user will ask you questions. You should clarify requirements, explain concepts, and guide the user. Do NOT write code or edit files. Just explain and ask clarifying questions.`;
  } else {
    modePrompt = `You are a helpful AI coding assistant running directly in the user's terminal on ${process.platform}.\nYou can read files, write files, edit files, list directories, and run shell commands using the provided tools.`;
  }

  let prompt = `${modePrompt}
When you need to suggest a shell command, wrap it in a triple-backtick code block with the language tag "sh" like this:

\`\`\`sh
ls -la
\`\`\`

The user will be prompted to approve and execute the command. The output will be fed back to you.
Keep responses concise and clear. Use markdown formatting.

The current working directory is: ${process.cwd()}

### Code Map
Here is a fast index of the current project directory so you know where things are without needing to call list_dir blindly:

${generateCodeMap()}
`;

  const projectCfg = findProjectConfig();
  if (projectCfg && (projectCfg.name === 'AGENTS.md' || projectCfg.name === '.ai-cli.md')) {
    try {
      const content = readFileSync(projectCfg.path, 'utf-8');
      prompt += `\n\n--- Project Instructions (${projectCfg.name}) ---\n${content}`;
    } catch {}
  }

  return prompt;
}

export function getProjectConfigOverrides() {
  const projectCfg = findProjectConfig();
  if (projectCfg && projectCfg.name === '.ai-cli.json') {
    try {
      return JSON.parse(readFileSync(projectCfg.path, 'utf-8'));
    } catch {}
  }
  return {};
}

export function buildInitialMessages(mode = 'build') {
  return [{ role: 'system', content: getSystemPrompt(mode) }];
}

export function warnMentions(warnings) {
  for (const w of warnings || []) p.log.warn(w);
}

export function recentUserText(msgs, n = 3) {
  const texts = [];
  for (let i = msgs.length - 1; i >= 0 && texts.length < n; i--) {
    const m = msgs[i];
    if (!m || m.role !== 'user') continue;
    let t = '';
    if (typeof m.content === 'string') t = m.content;
    else if (Array.isArray(m.content)) {
      const part = m.content.find((x) => x?.type === 'text');
      if (part) t = part.text;
    }
    if (t && t.trim()) texts.push(t);
  }
  return texts.reverse().join('\n');
}
