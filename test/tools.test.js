import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { executeTool, planLineEdits, isBlockedHost } from '../src/tools.js';

describe('tools.js path containment guards', () => {
  const created = [];
  afterEach(() => {
    for (const f of created.splice(0)) {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
  });

  it('read_file refuses paths outside the project directory', async () => {
    expect((await executeTool('read_file', { path: '../../etc/passwd' })).error).toMatch(/Refusing to read outside/);
    expect((await executeTool('read_file', { path: '/etc/passwd' })).error).toMatch(/Refusing to read outside/);
  });

  it('read_file still reads an in-project file', async () => {
    const res = await executeTool('read_file', { path: 'package.json' });
    expect(res.content).toContain('"name": "aplotita"');
  });

  it('list_dir refuses paths outside the project directory', async () => {
    expect((await executeTool('list_dir', { path: '../../' })).error).toMatch(/Refusing to list outside/);
    expect((await executeTool('list_dir', { path: '/etc' })).error).toMatch(/Refusing to list outside/);
  });

  it('list_dir still lists the project directory', async () => {
    const res = await executeTool('list_dir', { path: '.' });
    expect(res.error).toBeUndefined();
    expect(typeof res.entries).toBe('string');
  });

  it('write_file refuses paths outside the project directory and writes nothing', async () => {
    expect((await executeTool('write_file', { path: '../../tmp/vexra_guard.txt', content: 'x' })).error).toMatch(/Refusing to write outside/);
    expect((await executeTool('write_file', { path: '/tmp/vexra_guard.txt', content: 'x' })).error).toMatch(/Refusing to write outside/);
    expect(existsSync('/tmp/vexra_guard.txt')).toBe(false);
  });

  it('edit_file and multi_edit_file refuse paths outside the project directory', async () => {
    expect((await executeTool('edit_file', { path: '../../tmp/vexra_guard.txt', start_line: 1, end_line: 1, content: 'x' })).error).toMatch(/Refusing to write outside/);
    expect((await executeTool('multi_edit_file', { path: '/etc/passwd', edits: [{ start_line: 1, end_line: 1, content: 'x' }] })).error).toMatch(/Refusing to write outside/);
  });

  it('write_file still writes inside the project directory', async () => {
    const rel = 'vexra_test_artifact.txt';
    created.push(join(process.cwd(), rel));
    const res = await executeTool('write_file', { path: rel, content: 'hello' });
    expect(res.success).toBe(true);
    expect(existsSync(join(process.cwd(), rel))).toBe(true);
  });
});

describe('tools.js grep_search', () => {
  it('finds a real match in the source tree', async () => {
    const res = await executeTool('grep_search', { pattern: 'executeTool', path: 'src' });
    expect(res.output).toMatch(/tools\.js/);
  });

  it('passes the pattern as a literal argument and never invokes a shell', async () => {
    const sentinel = '/tmp/vexra_grep_pwned';
    try { if (existsSync(sentinel)) unlinkSync(sentinel); } catch {}
    await executeTool('grep_search', { pattern: `nomatch"; touch ${sentinel}; echo "` });
    expect(existsSync(sentinel)).toBe(false);
  });
});

describe('tools.js line edits', () => {
  const rel = 'aplotita_edit_artifact.txt';
  const full = join(process.cwd(), rel);
  afterEach(() => { try { if (existsSync(full)) unlinkSync(full); } catch {} });

  it('applies non-overlapping edits against the original line numbers in any order', async () => {
    writeFileSync(full, 'a\nb\nc\nd\ne\n');
    const res = await executeTool('multi_edit_file', { path: rel, edits: [
      { start_line: 2, end_line: 2, content: 'B' },
      { start_line: 4, end_line: 5, content: 'D\nE' },
    ] });
    expect(res.success).toBe(true);
    expect(readFileSync(full, 'utf-8')).toBe('a\nB\nc\nD\nE\n');
  });

  it('rejects overlapping edits and leaves the file untouched', async () => {
    writeFileSync(full, 'a\nb\nc\nd\ne\n');
    const res = await executeTool('multi_edit_file', { path: rel, edits: [
      { start_line: 2, end_line: 4, content: 'X' },
      { start_line: 3, end_line: 3, content: 'Y' },
    ] });
    expect(res.error).toMatch(/overlap/);
    expect(readFileSync(full, 'utf-8')).toBe('a\nb\nc\nd\ne\n');
  });

  it('rejects out-of-range edits', async () => {
    writeFileSync(full, 'a\nb\n');
    const res = await executeTool('edit_file', { path: rel, start_line: 9, end_line: 9, content: 'x' });
    expect(res.error).toMatch(/Invalid line range/);
  });

  it('planLineEdits allows inserts at the end of the file', () => {
    expect(planLineEdits(3, [{ start_line: 4, end_line: 3, content: 'z' }]).error).toBeUndefined();
  });
});

describe('tools.js syntax check', () => {
  const rel = 'aplotita_syntax_artifact.js';
  const full = join(process.cwd(), rel);
  afterEach(() => { try { if (existsSync(full)) unlinkSync(full); } catch {} });

  it('reports a saved file with a syntax problem as success plus a warning', async () => {
    const res = await executeTool('write_file', { path: rel, content: 'function (' });
    expect(res.success).toBe(true);
    expect(res.warning).toMatch(/syntax error/);
    expect(existsSync(full)).toBe(true);
  });
});

describe('tools.js manage_workspace', () => {
  it('never hands its arguments to a shell', async () => {
    const sentinel = join(tmpdir(), 'aplotita_worktree_pwned');
    try { if (existsSync(sentinel)) unlinkSync(sentinel); } catch {}
    const res = await executeTool('manage_workspace', { action: 'remove', path: `nope; touch ${sentinel}` });
    expect(res.error).toMatch(/git worktree failed/);
    expect(existsSync(sentinel)).toBe(false);
  });

  it('rejects option-like arguments', async () => {
    const res = await executeTool('manage_workspace', { action: 'create', path: '--force', branch: 'x' });
    expect(res.error).toMatch(/must not start/);
  });
});

describe('tools.js grep_search scope', () => {
  it('refuses to search outside the project', async () => {
    expect((await executeTool('grep_search', { pattern: 'root', path: '/etc' })).error).toMatch(/Refusing to search outside/);
  });

  it('reports no matches without falling through to slower tools', async () => {
    const res = await executeTool('grep_search', { pattern: 'zz_no_such_token_' + 'anywhere_42', path: 'src' });
    expect(res.output).toBe('(no matches found)');
  });
});

describe('isBlockedHost', () => {
  it('blocks loopback, private, CGNAT and IPv4-mapped IPv6 addresses', () => {
    for (const h of ['localhost', 'api.localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '[::ffff:7f00:1]', '::ffff:127.0.0.1', 'fd12:3456::1']) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it('allows public hosts', () => {
    for (const h of ['example.com', '93.184.216.34', '[2606:4700::1111]', '100.128.0.1']) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });
});
