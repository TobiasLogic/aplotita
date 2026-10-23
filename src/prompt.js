import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { generateCodeMap } from './codemap.js';
import { pickProjectSettings } from './config.js';

export const INSTRUCTION_FILES = ['AGENTS.md', '.aplotita.md', '.ai-cli.md'];
export const SETTINGS_FILES = ['.aplotita.json', '.ai-cli.json'];

export function findProjectFile(names, start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    for (const name of names) {
      const full = join(dir, name);
      if (existsSync(full)) return { path: full, dir, name };
    }
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findProjectConfig() {
  return findProjectFile([...INSTRUCTION_FILES, ...SETTINGS_FILES]);
}

const SHELL_HINT = `To run a command, call the run_shell tool. If you only want to suggest a command for the user to run themselves, put it in a triple-backtick block tagged "sh" and they will be offered to run it.`;

export function getSystemPrompt(mode = 'build') {
  let modePrompt = '';
  if (mode === 'architect') {
    modePrompt = `You are a senior software architect running in the user's terminal. Analyze the codebase, plan system designs, and propose architecture changes. You can read and search the project and write markdown documents, but you cannot run commands or change source files in this mode. Focus on design documents, diagrams, and high-level strategy.`;
  } else if (mode === 'ask') {
    modePrompt = `You are a senior mentor running in the user's terminal. The user will ask you questions. Clarify requirements, explain concepts, and guide the user. You can read and search the project, but you cannot edit files or run commands in this mode.`;
  } else {
    modePrompt = `You are a helpful AI coding assistant running directly in the user's terminal on ${process.platform}.\nYou can read files, write files, edit files, list directories, and run shell commands using the provided tools.\n${SHELL_HINT}`;
  }

  let prompt = `${modePrompt}
Keep responses concise and clear. Use markdown formatting.

The current working directory is: ${process.cwd()}

### Code Map
Here is a fast index of the current project directory so you know where things are without needing to call list_dir blindly:

${generateCodeMap()}
`;

  const instructions = findProjectFile(INSTRUCTION_FILES);
  if (instructions) {
    try {
      const content = readFileSync(instructions.path, 'utf-8');
      prompt += `\n\n--- Project Instructions (${instructions.name}) ---\n${content}`;
    } catch {}
  }

  return prompt;
}

export function readProjectSettings() {
  const found = findProjectFile(SETTINGS_FILES);
  if (!found) return { path: null, overrides: {}, ignored: [] };
  try {
    const { overrides, ignored } = pickProjectSettings(JSON.parse(readFileSync(found.path, 'utf-8')));
    return { path: found.path, overrides, ignored };
  } catch (err) {
    return { path: found.path, overrides: {}, ignored: [], error: err.message };
  }
}

export function getProjectConfigOverrides() {
  return readProjectSettings().overrides;
}

export function buildInitialMessages(mode = 'build') {
  return [{ role: 'system', content: getSystemPrompt(mode) }];
}

export function warnMentions(warnings, ui) {
  for (const w of warnings || []) ui.log('warn', w);
}

export function withRetrieval(messages, block) {
  if (!block) return messages;
  let idx = -1;
  for (let i = messages.length - 1; i >= 1; i--) {
    if (messages[i]?.role === 'user') { idx = i; break; }
  }
  if (idx === -1) return messages;
  const msg = messages[idx];
  let content;
  if (typeof msg.content === 'string') content = msg.content + block;
  else if (Array.isArray(msg.content)) content = [...msg.content, { type: 'text', text: block.trimStart() }];
  else return messages;
  const out = messages.slice();
  out[idx] = { ...msg, content };
  return out;
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
