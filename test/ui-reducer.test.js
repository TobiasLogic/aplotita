import { describe, it, expect } from 'vitest';
import {
  initialState, addBlock, patchBlock, setStatus, setOverlay, clearBlocks, splitBlocks,
} from '../src/ui/reducer.js';

describe('ui reducer', () => {
  it('starts empty', () => {
    expect(initialState()).toEqual({ blocks: [], status: null, overlay: null });
  });

  it('addBlock and patchBlock are immutable', () => {
    const s0 = initialState();
    const s1 = addBlock(s0, { id: 'a', type: 'user', text: 'hi' });
    expect(s0.blocks).toHaveLength(0);
    expect(s1.blocks).toHaveLength(1);

    const s2 = patchBlock(s1, 'a', { text: 'bye' });
    expect(s1.blocks[0].text).toBe('hi');
    expect(s2.blocks[0].text).toBe('bye');
  });

  it('setStatus and setOverlay do not mutate', () => {
    const s0 = initialState();
    expect(setStatus(s0, 'Thinking').status).toBe('Thinking');
    expect(setOverlay(s0, { kind: 'approval' }).overlay).toEqual({ kind: 'approval' });
    expect(s0.status).toBe(null);
    expect(s0.overlay).toBe(null);
  });

  it('clearBlocks keeps status/overlay but empties blocks', () => {
    let s = addBlock(initialState(), { id: 'a', type: 'user' });
    s = setStatus(s, 'x');
    expect(clearBlocks(s)).toEqual({ blocks: [], status: 'x', overlay: null });
  });

  it('splitBlocks commits everything before the first not-done block', () => {
    const blocks = [
      { id: '1', done: true },
      { id: '2', done: true },
      { id: '3', done: false },
      { id: '4', done: true },
    ];
    const { staticBlocks, liveBlocks } = splitBlocks(blocks);
    expect(staticBlocks.map((b) => b.id)).toEqual(['1', '2']);
    expect(liveBlocks.map((b) => b.id)).toEqual(['3', '4']);
  });

  it('splitBlocks: all done -> everything static', () => {
    const blocks = [{ id: '1', done: true }, { id: '2', done: true }];
    const { staticBlocks, liveBlocks } = splitBlocks(blocks);
    expect(staticBlocks).toHaveLength(2);
    expect(liveBlocks).toHaveLength(0);
  });
});
