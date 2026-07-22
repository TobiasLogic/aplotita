import { describe, it, expect, vi } from 'vitest';
import { renderMarkdownLine, createStreamWriter } from '../src/render.js';

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
