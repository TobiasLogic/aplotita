import { describe, it, expect } from 'vitest';
import { recentUserText } from '../src/repl.js';

describe('recentUserText', () => {
  it('concatenates the last N user turns in chronological order', () => {
    const msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'add a login form' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'now style it' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'fix that' },
    ];
    expect(recentUserText(msgs, 3)).toBe('add a login form\nnow style it\nfix that');
    expect(recentUserText(msgs, 2)).toBe('now style it\nfix that');
  });

  it('ignores non-user roles and empty turns', () => {
    const msgs = [
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: '   ' },
      { role: 'tool', tool_call_id: 'x', content: '{}' },
      { role: 'user', content: 'real question' },
    ];
    expect(recentUserText(msgs, 3)).toBe('real question');
  });

  it('extracts the text part from multimodal user content', () => {
    const msgs = [
      { role: 'user', content: [{ type: 'text', text: 'look at this' }, { type: 'image_url', image_url: { url: 'data:...' } }] },
    ];
    expect(recentUserText(msgs, 3)).toBe('look at this');
  });

  it('returns an empty string when there are no user turns', () => {
    expect(recentUserText([{ role: 'system', content: 's' }], 3)).toBe('');
    expect(recentUserText([], 3)).toBe('');
  });
});
