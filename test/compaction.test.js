import { describe, it, expect } from 'vitest';
import {
  compactMessages, planEviction, stripImagesForSummary, lastUserIndex,
} from '../src/compaction.js';
import { estimateMessagesTokens } from '../src/tokens.js';

const sys = () => ({ role: 'system', content: 'system prompt' });

describe('stripImagesForSummary', () => {
  it('replaces image parts with a placeholder and drops base64', () => {
    const msgs = [
      { role: 'user', content: [
        { type: 'text', text: 'see this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(5000) } },
      ] },
      { role: 'assistant', content: 'plain string stays' },
    ];
    const out = stripImagesForSummary(msgs);
    expect(out[0].content).toBe('see this\n[image omitted]');
    expect(JSON.stringify(out)).not.toContain('AAAA');
    expect(out[1].content).toBe('plain string stays');
  });
});

describe('planEviction', () => {
  it('never leaves a tool result orphaned from its tool_call', () => {
    const messages = [
      sys(),
      { role: 'assistant', content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'read', arguments: 'x'.repeat(2800) } }] },
      { role: 'tool', tool_call_id: '1', content: 'y'.repeat(200) },
      { role: 'user', content: 'now do it' },
      { role: 'assistant', content: 'sure' },
    ];
    const current = estimateMessagesTokens(messages);
    const { evicted, kept } = planEviction(messages, { low: 500, currentTokens: current, force: false });

    expect(kept[0].role).not.toBe('tool');
    expect(evicted.some((m) => m.role === 'tool')).toBe(true);
    expect(evicted.some((m) => Array.isArray(m.tool_calls))).toBe(true);
  });

  it('force mode evicts everything before the last user turn', () => {
    const messages = [
      sys(),
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
    ];
    const { evicted, kept } = planEviction(messages, { low: 999999, currentTokens: 10, force: true });
    expect(evicted.map((m) => m.content)).toEqual(['u1', 'a1']);
    expect(kept.map((m) => m.content)).toEqual(['u2', 'a2']);
    expect(lastUserIndex(messages)).toBe(3);
  });
});

describe('compactMessages', () => {
  function tinyConversation(n) {
    const msgs = [sys()];
    for (let i = 0; i < n; i++) msgs.push({ role: i % 2 ? 'assistant' : 'user', content: 'hi' });
    return msgs;
  }
  function bigConversation() {
    return [
      sys(),
      { role: 'user', content: 'A'.repeat(4000) },
      { role: 'assistant', content: 'B'.repeat(4000) },
      { role: 'user', content: 'recent question' },
      { role: 'assistant', content: 'recent answer' },
    ];
  }

  it('triggers on the token threshold, not the message count', async () => {
    const messages = tinyConversation(50);
    const calls = [];
    const result = await compactMessages(messages, {
      window: 2000, highWatermark: 0.75, lowWatermark: 0.5,
      summarize: async (m) => { calls.push(m); return 'X'; },
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('under-threshold');
    expect(calls).toHaveLength(0);
    expect(messages).toHaveLength(51);
  });

  it('compacts when over the high watermark, preserving the system message', async () => {
    const messages = bigConversation();
    const original = messages[0];
    const result = await compactMessages(messages, {
      window: 2000, highWatermark: 0.75, lowWatermark: 0.5,
      summarize: async () => 'CONDENSED SUMMARY',
    });
    expect(result.compacted).toBe(true);
    expect(messages[0]).toBe(original);
    expect(messages[1].role).toBe('system');
    expect(messages[1].content).toContain('CONDENSED SUMMARY');
    expect(messages.at(-1).content).toBe('recent answer');
  });

  it('drives the token estimate below the low watermark', async () => {
    const messages = bigConversation();
    const low = 0.5 * 2000;
    const result = await compactMessages(messages, {
      window: 2000, highWatermark: 0.75, lowWatermark: 0.5,
      summarize: async () => 'short',
    });
    expect(result.tokens).toBeLessThan(low);
    expect(estimateMessagesTokens(messages)).toBeLessThan(low);
  });

  it('strips images out of the summary input', async () => {
    const messages = [
      sys(),
      { role: 'user', content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'Z'.repeat(4000) } },
      ] },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'newest' },
      { role: 'assistant', content: 'reply' },
    ];
    let captured = null;
    await compactMessages(messages, {
      window: 100000, force: true,
      summarize: async (m) => { captured = m; return 'S'; },
    });
    expect(JSON.stringify(captured)).not.toContain('ZZZ');
    expect(JSON.stringify(captured)).toContain('[image omitted]');
  });

  it('hard-drops the evicted slice when summarization fails', async () => {
    const messages = bigConversation();
    const original = messages[0];
    const before = estimateMessagesTokens(messages);
    const result = await compactMessages(messages, {
      window: 2000, highWatermark: 0.75, lowWatermark: 0.5,
      summarize: async () => { throw new Error('network down'); },
    });
    expect(result.compacted).toBe(true);
    expect(result.reason).toBe('dropped');
    expect(messages[0]).toBe(original);
    expect(messages.some((m) => m.role === 'system' && m.content.includes('Summary of earlier'))).toBe(false);
    expect(estimateMessagesTokens(messages)).toBeLessThan(before);
    expect(messages.at(-1).content).toBe('recent answer');
  });

  it('reports nothing to compact when forced with no older history', async () => {
    const messages = [sys(), { role: 'user', content: 'only turn' }, { role: 'assistant', content: 'reply' }];
    const result = await compactMessages(messages, {
      window: 100000, force: true, summarize: async () => 'S',
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('nothing-to-evict');
    expect(messages).toHaveLength(3);
  });
});
