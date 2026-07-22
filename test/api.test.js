import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseSSELine, parseRetryAfter, backoffMs, fetchWithRetry, streamChat } from '../src/api.js';

describe('parseSSELine', () => {
  it('skips empty lines', () => {
    expect(parseSSELine('')).toEqual({ type: 'skip' });
    expect(parseSSELine('   ')).toEqual({ type: 'skip' });
  });

  it('skips non-data lines', () => {
    expect(parseSSELine('event: message')).toEqual({ type: 'skip' });
  });

  it('handles [DONE]', () => {
    expect(parseSSELine('data: [DONE]')).toEqual({ type: 'done' });
  });

  it('parses valid event data', () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: 'hello' } }]
    });
    expect(parseSSELine(`data: ${chunk}`)).toEqual({
      type: 'event',
      value: {
        content: 'hello',
        role: null,
        finish: null,
        toolCalls: null,
      }
    });
  });

  it('parses valid usage data', () => {
    const chunk = JSON.stringify({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      }
    });
    expect(parseSSELine(`data: ${chunk}`)).toEqual({
      type: 'usage',
      value: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30
      }
    });
  });

  it('handles JSON parse errors', () => {
    expect(parseSSELine('data: { bad json')).toEqual({ type: 'error' });
  });
});

describe('parseRetryAfter', () => {
  it('returns null for a missing header', () => {
    expect(parseRetryAfter(null)).toBe(null);
    expect(parseRetryAfter(undefined)).toBe(null);
    expect(parseRetryAfter('')).toBe(null);
  });

  it('parses numeric seconds into milliseconds', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('clamps to a 30s ceiling and a 0 floor', () => {
    expect(parseRetryAfter('100')).toBe(30000);
    expect(parseRetryAfter('-3')).toBe(0);
  });

  it('parses HTTP-date values relative to now', () => {
    expect(parseRetryAfter(new Date(Date.now() - 10000).toUTCString())).toBe(0);
    expect(parseRetryAfter(new Date(Date.now() + 3600000).toUTCString())).toBe(30000);
  });

  it('returns null for unparseable values', () => {
    expect(parseRetryAfter('not-a-date')).toBe(null);
  });
});

describe('backoffMs', () => {
  it('grows exponentially and caps at 8s with jitter pinned to 0', () => {
    const r = vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(backoffMs(1)).toBe(500);
    expect(backoffMs(2)).toBe(1000);
    expect(backoffMs(3)).toBe(2000);
    expect(backoffMs(20)).toBe(8000);
    r.mockRestore();
  });

  it('adds bounded jitter under 250ms', () => {
    for (let i = 0; i < 50; i++) {
      const v = backoffMs(1);
      expect(v).toBeGreaterThanOrEqual(500);
      expect(v).toBeLessThan(750);
    }
  });
});

describe('fetchWithRetry', () => {
  function resp({ ok = true, status = 200, retryAfter = null } = {}) {
    return {
      ok,
      status,
      headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? retryAfter : null) },
      text: async () => '',
      json: async () => ({}),
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns immediately on a successful response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithRetry('http://x', {}, { maxRetries: 3 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry 4xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp({ ok: false, status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithRetry('http://x', {}, { maxRetries: 3 });
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resp({ ok: false, status: 503, retryAfter: '0' }))
      .mockResolvedValueOnce(resp({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithRetry('http://x', {}, { maxRetries: 3 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 429 then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resp({ ok: false, status: 429, retryAfter: '0' }))
      .mockResolvedValueOnce(resp({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithRetry('http://x', {}, { maxRetries: 3 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and returns the last response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp({ ok: false, status: 503, retryAfter: '0' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithRetry('http://x', {}, { maxRetries: 2 });
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries network errors then throws after maxRetries', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchMock);
    const promise = fetchWithRetry('http://x', {}, { maxRetries: 2 });
    const assertion = expect(promise).rejects.toThrow('ECONNRESET');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry an aborted request', async () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    const fetchMock = vi.fn().mockRejectedValue(err);
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry('http://x', {}, { maxRetries: 3 })).rejects.toThrow('Aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('streamChat request building', () => {
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

  async function collect(gen) {
    const out = [];
    for await (const c of gen) out.push(c);
    return out;
  }

  function captureFetch(lines = ['data: [DONE]']) {
    const calls = [];
    const mock = vi.fn(async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return streamResponse(lines);
    });
    vi.stubGlobal('fetch', mock);
    return calls;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('posts an OpenAI-style chat completion to the base URL', async () => {
    const calls = captureFetch();
    await collect(streamChat([{ role: 'user', content: 'hi' }], {
      apiKey: 'k', baseUrl: 'https://api.test/v1', model: 'm1', temperature: 0.5, maxTokens: 123,
    }));
    expect(calls[0].url).toBe('https://api.test/v1/chat/completions');
    expect(calls[0].options.headers.Authorization).toBe('Bearer k');
    expect(calls[0].body).toMatchObject({
      model: 'm1', temperature: 0.5, max_tokens: 123, stream: true,
      stream_options: { include_usage: true },
    });
  });

  const conversation = () => ([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
  ]);

  it('applies cache_control for OpenRouter (system + last cacheable message)', async () => {
    const calls = captureFetch();
    const msgs = conversation();
    await collect(streamChat(msgs, { apiKey: 'k', provider: 'openrouter' }));
    const body = calls[0].body;
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(Array.isArray(body.messages[2].content)).toBe(true);
    expect(body.messages[2].content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(typeof body.messages[1].content).toBe('string');
    expect(typeof body.messages[4].content).toBe('string');
    expect(typeof msgs[0].content).toBe('string');
  });

  it('infers OpenRouter from the default base URL and still applies cache_control', async () => {
    const calls = captureFetch();
    await collect(streamChat(conversation(), { apiKey: 'k' }));
    expect(Array.isArray(calls[0].body.messages[0].content)).toBe(true);
  });

  it('does NOT apply cache_control for OpenAI-compatible providers that may reject it', async () => {
    for (const opts of [
      { apiKey: 'k', provider: 'openai', baseUrl: 'https://api.openai.com/v1' },
      { apiKey: 'k', provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1' },
      { apiKey: 'k', baseUrl: 'https://my-llm.example/v1' },
    ]) {
      const calls = captureFetch();
      await collect(streamChat(conversation(), opts));
      const body = calls[0].body;
      expect(body.messages.every((m) => typeof m.content === 'string')).toBe(true);
      expect(JSON.stringify(body)).not.toContain('cache_control');
    }
  });

  it('sends the OpenRouter routing field only for OpenRouter', async () => {
    let calls = captureFetch();
    await collect(streamChat(conversation(), { apiKey: 'k', provider: 'openrouter' }));
    expect(calls[0].body.provider).toEqual({ allow_fallbacks: false });

    calls = captureFetch();
    await collect(streamChat(conversation(), { apiKey: 'k', provider: 'openai', baseUrl: 'https://api.openai.com/v1' }));
    expect(calls[0].body.provider).toBeUndefined();
  });

  it('sends referer and title headers only when provided', async () => {
    let calls = captureFetch();
    await collect(streamChat([{ role: 'user', content: 'x' }], { apiKey: 'k', referer: 'https://vexra', title: 'vexra' }));
    expect(calls[0].options.headers['HTTP-Referer']).toBe('https://vexra');
    expect(calls[0].options.headers['X-Title']).toBe('vexra');

    calls = captureFetch();
    await collect(streamChat([{ role: 'user', content: 'x' }], { apiKey: 'k' }));
    expect(calls[0].options.headers['HTTP-Referer']).toBeUndefined();
    expect(calls[0].options.headers['X-Title']).toBeUndefined();
  });

  it('includes tools when provided and omits the key otherwise', async () => {
    const tools = [{ type: 'function', function: { name: 'f', parameters: {} } }];
    let calls = captureFetch();
    await collect(streamChat([{ role: 'user', content: 'x' }], { apiKey: 'k', tools }));
    expect(calls[0].body.tools).toEqual(tools);

    calls = captureFetch();
    await collect(streamChat([{ role: 'user', content: 'x' }], { apiKey: 'k' }));
    expect(calls[0].body.tools).toBeUndefined();
  });

  it('yields content deltas and a usage event from the stream', async () => {
    captureFetch([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: {"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
      'data: [DONE]',
    ]);
    const chunks = await collect(streamChat([{ role: 'user', content: 'x' }], { apiKey: 'k' }));
    expect(chunks.filter((c) => c.content).map((c) => c.content).join('')).toBe('Hello');
    expect(chunks.find((c) => c._type === 'usage')).toMatchObject({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  });

  it('throws a descriptive error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 400, headers: { get: () => null },
      json: async () => ({ error: { message: 'bad field' } }),
      text: async () => 'bad field',
    })));
    await expect(collect(streamChat([{ role: 'user', content: 'x' }], { apiKey: 'k', maxRetries: 0 }))).rejects.toThrow(/400.*bad field/);
  });
});
