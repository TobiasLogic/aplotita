import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findProjectFile, withRetrieval, INSTRUCTION_FILES, SETTINGS_FILES } from '../src/prompt.js';
import { modeRestriction, toolsForMode } from '../src/permissions.js';
import { historyFile } from '../src/history.js';
import { isValidSessionName } from '../src/sessions.js';
import { TOOL_DEFINITIONS } from '../src/tools.js';

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

describe('project files', () => {
  it('finds instructions and settings independently', () => {
    const root = mkdtempSync(join(tmpdir(), 'aplotita-proj-'));
    dirs.push(root);
    writeFileSync(join(root, 'AGENTS.md'), 'rules');
    writeFileSync(join(root, '.ai-cli.json'), '{"model":"m"}');
    mkdirSync(join(root, 'pkg'));
    expect(findProjectFile(INSTRUCTION_FILES, join(root, 'pkg')).name).toBe('AGENTS.md');
    expect(findProjectFile(SETTINGS_FILES, join(root, 'pkg')).name).toBe('.ai-cli.json');
  });
});

describe('withRetrieval', () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'second' },
    { role: 'tool', tool_call_id: '1', content: '{}' },
  ];

  it('attaches snippets to the latest user turn and keeps the system prompt stable', () => {
    const out = withRetrieval(msgs, '\n\nSNIPPET');
    expect(out[0].content).toBe('sys');
    expect(out[3].content).toBe('second\n\nSNIPPET');
    expect(msgs[3].content).toBe('second');
    expect(out[1]).toBe(msgs[1]);
  });

  it('adds a text part to multimodal user content', () => {
    const out = withRetrieval([{ role: 'system', content: 's' }, { role: 'user', content: [{ type: 'text', text: 'look' }] }], '\n\nSNIP');
    expect(out[1].content.at(-1)).toEqual({ type: 'text', text: 'SNIP' });
  });

  it('is a no-op without a block', () => {
    expect(withRetrieval(msgs, '')).toBe(msgs);
  });
});

describe('mode permissions', () => {
  const names = (mode) => toolsForMode(mode, TOOL_DEFINITIONS).map((d) => d.function.name);

  it('ask mode only exposes read-only tools', () => {
    const ask = names('ask');
    expect(ask).toContain('read_file');
    for (const t of ['write_file', 'edit_file', 'run_shell', 'spawn_background_task', 'invoke_subagent', 'manage_workspace']) {
      expect(ask).not.toContain(t);
    }
  });

  it('architect mode can only write markdown', () => {
    expect(names('architect')).not.toContain('run_shell');
    expect(modeRestriction('architect', 'write_file', { path: 'docs/plan.md' })).toBe(null);
    expect(modeRestriction('architect', 'write_file', { path: 'src/app.js' })).toMatch(/markdown/);
  });

  it('build mode allows everything', () => {
    expect(names('build')).toHaveLength(TOOL_DEFINITIONS.length);
    expect(modeRestriction('build', 'run_shell', {})).toBe(null);
  });
});

describe('history and sessions', () => {
  it('keeps a separate history file per project folder', () => {
    expect(historyFile('/work/a')).not.toBe(historyFile('/work/b'));
    expect(historyFile('/work/a')).toBe(historyFile('/work/a'));
  });

  it('rejects session names that could escape the sessions folder', () => {
    expect(isValidSessionName('my-session_1.2')).toBe(true);
    for (const bad of ['../config', '.hidden', 'a/b', '', 'a\\b']) expect(isValidSessionName(bad)).toBe(false);
  });
});
