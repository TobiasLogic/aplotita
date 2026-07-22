import { describe, it, expect } from 'vitest';
import {
  estimateTokens, estimateMessageTokens, estimateMessagesTokens, IMAGE_TOKEN_COST,
} from '../src/tokens.js';

describe('estimateTokens', () => {
  it('is monotonic in string length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdabcd')).toBe(2);
    expect(estimateTokens('x'.repeat(1000))).toBeGreaterThan(estimateTokens('x'.repeat(100)));
  });

  it('treats a string and an equivalent text part the same', () => {
    expect(estimateTokens('hello there')).toBe(estimateTokens([{ type: 'text', text: 'hello there' }]));
  });

  it('counts each image as a flat cost, never via its base64 length', () => {
    const bigBase64 = 'A'.repeat(200000);
    const content = [
      { type: 'text', text: 'hi' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${bigBase64}` } },
    ];
    const tokens = estimateTokens(content);
    expect(tokens).toBe(IMAGE_TOKEN_COST + estimateTokens('hi'));
    expect(tokens).toBeLessThan(2000);
  });

  it('handles two images additively', () => {
    const img = { type: 'image_url', image_url: { url: 'data:...' } };
    expect(estimateTokens([img, img])).toBe(IMAGE_TOKEN_COST * 2);
  });
});

describe('estimateMessagesTokens', () => {
  it('sums per-message estimates', () => {
    const msgs = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello there friend' },
    ];
    expect(estimateMessagesTokens(msgs)).toBe(
      estimateMessageTokens(msgs[0]) + estimateMessageTokens(msgs[1])
    );
  });

  it('accounts for tool_call arguments', () => {
    const base = { role: 'assistant', content: '' };
    const withTools = {
      role: 'assistant', content: '',
      tool_calls: [{ id: '1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }],
    };
    expect(estimateMessageTokens(withTools)).toBeGreaterThan(estimateMessageTokens(base));
  });
});
