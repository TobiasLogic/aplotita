import { describe, it, expect } from 'vitest';
import { createPasteState, feedPasteKey, insertPaste } from '../src/paste.js';

function feed(state, events) {
  return events.map(([str, key]) => feedPasteKey(state, str, key));
}

describe('feedPasteKey', () => {
  it('passes keys through when no paste is active', () => {
    const state = createPasteState();
    expect(feedPasteKey(state, 'a', { name: 'a' })).toEqual({ type: 'passthrough' });
    expect(feedPasteKey(state, '\r', { name: 'return' })).toEqual({ type: 'passthrough' });
  });

  it('buffers a multi-line paste and keeps newlines instead of submitting', () => {
    const state = createPasteState();
    const results = feed(state, [
      [undefined, { name: 'paste-start', code: '[200~' }],
      ['l', { name: 'l' }],
      ['i', { name: 'i' }],
      ['n', { name: 'n' }],
      ['e', { name: 'e' }],
      ['1', { name: '1' }],
      ['\r', { name: 'return' }],
      ['l', { name: 'l' }],
      ['i', { name: 'i' }],
      ['n', { name: 'n' }],
      ['e', { name: 'e' }],
      ['2', { name: '2' }],
      [undefined, { name: 'paste-end', code: '[201~' }],
    ]);

    expect(results[0]).toEqual({ type: 'start' });
    expect(results.slice(1, -1).every((r) => r.type === 'accumulate')).toBe(true);
    expect(results.at(-1)).toEqual({ type: 'end', text: 'line1\nline2' });
    expect(state.active).toBe(false);
  });

  it('treats a paste-end without an active paste as passthrough', () => {
    const state = createPasteState();
    expect(feedPasteKey(state, undefined, { name: 'paste-end' })).toEqual({ type: 'passthrough' });
  });

  it('tolerates missing str during a paste', () => {
    const state = createPasteState();
    feedPasteKey(state, undefined, { name: 'paste-start' });
    feedPasteKey(state, undefined, { name: undefined });
    feedPasteKey(state, 'x', { name: 'x' });
    expect(feedPasteKey(state, undefined, { name: 'paste-end' })).toEqual({ type: 'end', text: 'x' });
  });
});

describe('insertPaste', () => {
  it('inserts pasted text at the cursor', () => {
    expect(insertPaste('hello ', 6, 'world')).toEqual({ line: 'hello world', cursor: 11 });
  });

  it('inserts into the middle of the line', () => {
    expect(insertPaste('ab', 1, 'XYZ')).toEqual({ line: 'aXYZb', cursor: 4 });
  });

  it('preserves newlines in the reconstructed line', () => {
    const { line } = insertPaste('', 0, 'one\ntwo\nthree');
    expect(line).toBe('one\ntwo\nthree');
    expect(line.split('\n')).toHaveLength(3);
  });

  it('clamps an out-of-range cursor', () => {
    expect(insertPaste('ab', 99, 'Z')).toEqual({ line: 'abZ', cursor: 3 });
    expect(insertPaste('ab', -5, 'Z')).toEqual({ line: 'Zab', cursor: 1 });
  });
});
