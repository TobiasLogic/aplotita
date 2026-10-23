import { describe, it, expect, vi } from 'vitest';
import { renderMarkdownLine, createStreamWriter, renderMarkdownToString, formatToolLine, formatUsage } from '../src/render.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('renderMarkdownLine', () => {
  it('styles headings and drops the # markers', () => {
    expect(strip(renderMarkdownLine('# Title'))).toContain('Title');
    expect(strip(renderMarkdownLine('# Title'))).not.toContain('#');
    expect(strip(renderMarkdownLine('## Section'))).toContain('Section');
    expect(strip(renderMarkdownLine('### Sub'))).not.toContain('#');
  });

  it('turns bullets into a real bullet glyph', () => {
    const out = strip(renderMarkdownLine('- do a thing'));
    expect(out).toContain('•');
    expect(out).toContain('do a thing');
    expect(out).not.toMatch(/^\s*-\s/);
  });

  it('keeps numbered list markers', () => {
    expect(strip(renderMarkdownLine('2. second'))).toContain('2.');
    expect(strip(renderMarkdownLine('2. second'))).toContain('second');
  });

  it('renders blockquotes with a gutter', () => {
    const out = strip(renderMarkdownLine('> note'));
    expect(out).toContain('▏');
    expect(out).toContain('note');
  });

  it('renders a horizontal rule for ---', () => {
    expect(strip(renderMarkdownLine('---'))).toMatch(/─{3,}/);
    expect(strip(renderMarkdownLine('***'))).toMatch(/─{3,}/);
  });

  it('strips inline code backticks and bold markers', () => {
    expect(strip(renderMarkdownLine('use `foo()` now'))).toBe('use foo() now');
    expect(strip(renderMarkdownLine('a **bold** word'))).toBe('a bold word');
  });
});

describe('createStreamWriter', () => {
  function capture(feed) {
    const chunks = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { chunks.push(s); return true; });
    feed();
    spy.mockRestore();
    return strip(chunks.join(''));
  }

  it('frames a fenced code block and keeps its content', () => {
    const out = capture(() => {
      const w = createStreamWriter();
      w('```js\n');
      w('const x = 1;\n');
      w('```\n');
      w.end();
    });
    expect(out).toContain('js');
    expect(out).toContain('const x = 1');
    expect(out).toContain('╭');
    expect(out).toContain('│');
    expect(out).toContain('╰');
  });

  it('flushes a trailing line with no newline on end()', () => {
    const out = capture(() => {
      const w = createStreamWriter();
      w('final line without newline');
      w.end();
    });
    expect(out).toContain('final line without newline');
  });

  it('reassembles markers split across chunks', () => {
    const out = capture(() => {
      const w = createStreamWriter();
      w('## Head');
      w('ing here\n');
      w.end();
    });
    expect(out).toContain('Heading here');
    expect(out).not.toContain('##');
  });
});

describe('markdown tables', () => {
  it('renders a pipe table as aligned columns with a header rule', () => {
    const out = strip(renderMarkdownToString('| File | Purpose |\n|---|---|\n| `a.js` | logic |\n| long-name.js | tests |\n\nafter'));
    const lines = out.split('\n');
    expect(lines[0]).toBe('  File           Purpose');
    expect(lines[1]).toMatch(/^  ─+   ─+$/);
    expect(lines[2]).toBe('  a.js           logic');
    expect(lines[3]).toBe('  long-name.js   tests');
    expect(out).not.toContain('|');
    expect(out).toContain('after');
  });

  it('right-aligns columns marked with a trailing colon', () => {
    const out = strip(renderMarkdownToString('| n | v |\n|---|---:|\n| a | 1 |\n| b | 100 |'));
    expect(out).toContain('  a     1');
    expect(out).toContain('  b   100');
  });

  it('leaves pipes inside code blocks alone', () => {
    const out = strip(renderMarkdownToString('```sh\n| not | a table |\n```'));
    expect(out).toContain('| not | a table |');
  });
});

describe('formatToolLine', () => {
  it('shows what the tool acted on and a one-line outcome', () => {
    expect(strip(formatToolLine({ name: 'write_file', args: { path: 'todo.js' }, result: { success: true, bytes: 812 } })))
      .toBe('  ✔ write_file todo.js · 812 bytes');
    expect(strip(formatToolLine({ name: 'run_shell', args: { command: 'npm test' }, result: { output: 'ℹ tests 7\nℹ fail 0' } })))
      .toBe('  ✔ run_shell $ npm test · ℹ fail 0');
  });

  it('flags non-zero exits, errors and blocked calls', () => {
    expect(strip(formatToolLine({ name: 'run_shell', args: { command: 'false' }, result: { output: '[exit code: 1]' } }))).toMatch(/^  ▲ run_shell/);
    expect(strip(formatToolLine({ name: 'read_file', args: { path: 'x' }, result: { error: 'File not found: x' } }))).toBe('  ✗ read_file x · File not found: x');
    expect(strip(formatToolLine({ name: 'write_file', args: { path: 'x' }, rejected: true, reason: 'not in ask mode' }))).toBe('  ⨯ write_file x · blocked: not in ask mode');
  });

  it('never spills multi-line output onto extra lines', () => {
    const line = strip(formatToolLine({ name: 'mcp__srv__do', args: { q: 'a\nb' }, result: { content: 'one\ntwo\nthree' } }));
    expect(line.split('\n')).toHaveLength(1);
  });
});

describe('formatUsage', () => {
  it('summarizes a whole turn compactly', () => {
    expect(formatUsage({ prompt: 45210, completion: 5320, rounds: 7 })).toBe('  7 requests · 45k in · 5.3k out');
    expect(formatUsage({ prompt: 900, completion: 40, rounds: 1 })).toBe('  900 in · 40 out');
  });
});

