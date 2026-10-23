import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveMentions, isVisionCapableModel } from '../src/context.js';

const tmpDirs = [];
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'vexra-ctx-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

describe('context.js', () => {
  it('should resolve @file mentions', () => {
    const result = resolveMentions('Look at @package.json');
    expect(result.context).toContain('aplotita');
    expect(result.text).toBe('Look at package.json');
  });

  it('leaves npm scopes and email addresses alone', () => {
    const input = 'add @types/node to devDependencies, ping me at me@example.com';
    const result = resolveMentions(input);
    expect(result.text).toBe(input);
    expect(result.context).toBe('');
    expect(result.warnings).toEqual([]);
  });

  it('tolerates trailing punctuation after a mention', () => {
    const dir = fixture({ 'notes.md': 'NOTES_BODY' });
    const result = resolveMentions('read @notes.md, then summarize', { cwd: dir });
    expect(result.context).toContain('NOTES_BODY');
    expect(result.text).toBe('read notes.md, then summarize');
  });

  it('warns about a mention that looks like a mistyped path and keeps it as text', () => {
    const dir = fixture({ 'a.txt': 'x' });
    mkdirSync(join(dir, 'src'));
    const result = resolveMentions('fix @src/missing.js', { cwd: dir });
    expect(result.text).toBe('fix @src/missing.js');
    expect(result.warnings[0]).toMatch(/Nothing matches @src\/missing\.js/);
  });

  it('attaches a listing when a directory is mentioned', () => {
    const dir = fixture({ 'one.js': '1', 'two.js': '2' });
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib', 'three.js'), '3');
    const result = resolveMentions('what is in @lib', { cwd: dir });
    expect(result.context).toContain('directory listing');
    expect(result.context).toContain('three.js');
  });
});

describe('isVisionCapableModel', () => {
  it('recognizes multimodal model families', () => {
    for (const m of ['openai/gpt-4o', 'gpt-4.1-mini', 'claude-sonnet-4-20250514', 'anthropic/claude-3.5-sonnet', 'gemini-2.5-flash', 'mistralai/pixtral-12b', 'claude-opus-5-5', 'openai/gpt-6.1-sol']) {
      expect(isVisionCapableModel(m)).toBe(true);
    }
  });

  it('treats unknown/text-only models as not vision-capable', () => {
    for (const m of ['deepseek-chat', 'llama-3.3-70b-versatile', 'mixtral-8x7b', '', undefined, null]) {
      expect(isVisionCapableModel(m)).toBe(false);
    }
  });
});

describe('resolveMentions image handling', () => {
  it('counts image bytes against the total budget so a huge image stops later files', () => {
    const dir = fixture({
      'big.png': Buffer.alloc(160 * 1024, 1),
      'after.txt': 'SENTINEL_TEXT_SHOULD_BE_SKIPPED',
    });
    const result = resolveMentions('see @big.png and @after.txt', { cwd: dir, model: 'gpt-4o' });
    expect(result.images).toHaveLength(1);
    expect(result.context).toContain('Total context limit reached');
    expect(result.context).not.toContain('SENTINEL_TEXT_SHOULD_BE_SKIPPED');
  });

  it('includes a small image without tripping the budget', () => {
    const dir = fixture({ 'small.png': Buffer.alloc(1024, 7), 'after.txt': 'INCLUDED_TEXT' });
    const result = resolveMentions('@small.png @after.txt', { cwd: dir, model: 'gpt-4o' });
    expect(result.images).toHaveLength(1);
    expect(result.context).not.toContain('Total context limit reached');
    expect(result.context).toContain('INCLUDED_TEXT');
  });

  it('warns when images are attached to a likely text-only model', () => {
    const dir = fixture({ 'pic.png': Buffer.alloc(64, 9) });
    const result = resolveMentions('@pic.png', { cwd: dir, model: 'deepseek-chat' });
    expect(result.images).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('deepseek-chat');
  });

  it('does not warn when the model is vision-capable', () => {
    const dir = fixture({ 'pic.png': Buffer.alloc(64, 9) });
    const result = resolveMentions('@pic.png', { cwd: dir, model: 'openai/gpt-4o' });
    expect(result.warnings).toHaveLength(0);
  });
});
