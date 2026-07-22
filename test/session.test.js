import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/history.js', () => ({
  saveHistory: () => {},
  loadHistory: () => null,
  HISTORY_FILE: '/tmp/vexra-test-history.json',
}));

const { createSession } = await import('../src/session.js');

function streamResponse(lines) {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + '\n'));
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
          cancel: async () => {},
          releaseLock() {},
        };
      },
    },
  };
}

function makeCtx(overrides = {}) {
  const ctx = {
    opts: {
      headless: true, model: 'test-model', apiKey: 'k', baseUrl: 'https://api.test/v1',
      temperature: 0.7, maxTokens: 100, context_window: 128000,
      compact_high_watermark: 0.75, compact_low_watermark: 0.5, maxRetries: 3,
      ...overrides,
    },
    messages: [{ role: 'system', content: 'system prompt' }],
    mode: 'build',
    indexer: null,
    retrievalBlock: '',
    lastPromptTokens: null,
    lastPromptLen: null,
    lastUserPromptIdx: null,
    isStreaming: false,
    loaderStyle: 'braille',
    stats: { tokenUsage: { prompt: 0, completion: 0, total: 0 }, startTime: Date.now(), messageCount: 0 },
  };
  Object.assign(ctx, createSession(ctx));
  return ctx;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('agent loop (integration, mocked network)', () => {
  it('runs a tool-call turn then a text turn and stops', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"nonexistent_tool","arguments":"{}"}}]}}]}',
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
        'data: [DONE]',
      ]))
      .mockResolvedValueOnce(streamResponse([
        'data: {"choices":[{"delta":{"content":"All done."}}]}',
        'data: {"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}}',
        'data: [DONE]',
      ]));
    vi.stubGlobal('fetch', fetchMock);

    const ctx = makeCtx();
    ctx.messages.push({ role: 'user', content: 'do the thing' });
    await ctx.agentLoop({ truncateOnError: ctx.messages.length - 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const assistantToolCall = ctx.messages.find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls));
    expect(assistantToolCall.tool_calls[0].function.name).toBe('nonexistent_tool');

    const toolResult = ctx.messages.find((m) => m.role === 'tool');
    expect(JSON.parse(toolResult.content).error).toMatch(/Unknown tool/);

    expect(ctx.messages.at(-1)).toEqual({ role: 'assistant', content: 'All done.' });
    expect(ctx.stats.tokenUsage.total).toBe(30);
    expect(ctx.lastPromptTokens).toBe(12);
  });

  it('truncates messages back to the anchor when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, headers: { get: () => null },
      json: async () => ({ error: { message: 'boom' } }),
      text: async () => 'boom',
    })));

    const ctx = makeCtx({ maxRetries: 0 });
    const anchor = ctx.messages.length;
    ctx.messages.push({ role: 'user', content: 'will fail' });
    await ctx.agentLoop({ truncateOnError: anchor });

    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].role).toBe('system');
  });
});
