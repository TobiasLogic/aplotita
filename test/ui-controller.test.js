import { describe, it, expect } from 'vitest';
import { createInkController } from '../src/ui/controller.js';

describe('ink controller', () => {
  it('adds a user block and streams an assistant block', () => {
    const c = createInkController();
    c.userMessage('hello');
    const a = c.startAssistant();
    a.appendDelta('par');
    a.appendDelta('tial');

    let blocks = c.getState().blocks;
    const asst = blocks.find((b) => b.type === 'assistant');
    expect(blocks.find((b) => b.type === 'user').text).toBe('hello');
    expect(asst.text).toBe('partial');
    expect(asst.done).toBe(false);

    a.done();
    expect(c.getState().blocks.find((b) => b.type === 'assistant').done).toBe(true);
  });

  it('setStatus updates status and notifies subscribers', () => {
    const c = createInkController();
    const seen = [];
    const off = c.subscribe((s) => seen.push(s.status));
    c.setStatus('Thinking');
    c.setStatus(null);
    off();
    c.setStatus('ignored');
    expect(seen).toEqual(['Thinking', null]);
  });

  it('requestApproval sets an overlay and resolves on answer', async () => {
    const c = createInkController();
    const promise = c.requestApproval({ verb: 'WRITE', target: 'x' });
    const overlay = c.getState().overlay;
    expect(overlay.kind).toBe('approval');
    expect(overlay.payload.target).toBe('x');

    overlay.resolve(true);
    await expect(promise).resolves.toBe(true);
    expect(c.getState().overlay).toBe(null);
  });

  it('requestSelect resolves the chosen value and clears the overlay', async () => {
    const c = createInkController();
    const promise = c.requestSelect({ message: 'Pick', options: [{ value: 'a', label: 'A' }] });
    const overlay = c.getState().overlay;
    expect(overlay.kind).toBe('select');
    overlay.resolve('a');
    await expect(promise).resolves.toBe('a');
    expect(c.getState().overlay).toBe(null);
  });

  it('clear empties the transcript blocks', () => {
    const c = createInkController();
    c.userMessage('a');
    c.userMessage('b');
    expect(c.getState().blocks).toHaveLength(2);
    c.clear();
    expect(c.getState().blocks).toHaveLength(0);
  });
});
