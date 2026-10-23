import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/history.js', () => ({
  saveHistory: () => {},
  loadHistory: () => null,
  historyFile: () => '/tmp/aplotita-test-history.json',
}));

const { createSession } = await import('../src/session.js');
const { BACKGROUND_TASKS } = await import('../src/executor.js');

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

function toolCallTurn(name, args) {
  return streamResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] })}`,
    'data: [DONE]',
  ]);
}

function textTurn(text) {
  return streamResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`, 'data: [DONE]']);
}

function fakeUi(approval) {
  const calls = [];
  return {
    calls,
    log() {}, note() {}, usage() {}, setStatus() {}, userMessage() {}, toolResult() {},
    shellStart() {}, shellChunk() {}, shellEnd() {},
    startAssistant: () => ({ appendDelta() {}, done() {} }),
    requestApproval: async (payload) => { calls.push(payload); return approval; },
    cancelPending() {},
  };
}

function interactiveCtx(ui, overrides = {}) {
  const ctx = {
    opts: { headless: false, model: 'test-model', apiKey: 'k', baseUrl: 'https://api.test/v1', context_window: 128000, maxRetries: 0, ...overrides },
    messages: [{ role: 'system', content: 'system prompt' }],
    mode: 'build', promptMode: 'build', indexer: null, retrievalBlock: '',
    lastPromptTokens: null, lastPromptLen: null, lastUserPromptIdx: null, isStreaming: false, loaderStyle: 'braille',
    stats: { tokenUsage: { prompt: 0, completion: 0, total: 0 }, startTime: Date.now(), messageCount: 0 },
    ui,
  };
  Object.assign(ctx, createSession(ctx));
  return ctx;
}

describe('approvals and modes', () => {
  it('asks before starting a background shell task', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(toolCallTurn('spawn_background_task', { command: 'echo hi' }))
      .mockResolvedValueOnce(textTurn('ok')));
    const ui = fakeUi(false);
    const ctx = interactiveCtx(ui);
    const before = BACKGROUND_TASKS.size;
    ctx.messages.push({ role: 'user', content: 'go' });
    await ctx.agentLoop({ truncateOnError: 1 });
    expect(ui.calls[0].verb).toBe('BACKGROUND');
    expect(BACKGROUND_TASKS.size).toBe(before);
    expect(JSON.parse(ctx.messages.find((m) => m.role === 'tool').content).error).toMatch(/rejected/);
  });

  it('remembers an "always" answer for the rest of the session', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(toolCallTurn('run_shell', { command: 'echo one' }))
      .mockResolvedValueOnce(toolCallTurn('run_shell', { command: 'echo two' }))
      .mockResolvedValueOnce(textTurn('done')));
    const ui = fakeUi('always');
    const ctx = interactiveCtx(ui);
    ctx.messages.push({ role: 'user', content: 'go' });
    await ctx.agentLoop({ truncateOnError: 1 });
    expect(ui.calls).toHaveLength(1);
    const outputs = ctx.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content).output);
    expect(outputs).toEqual(['one', 'two']);
  });

  it('never runs a destructive command unattended in headless mode', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(toolCallTurn('run_shell', { command: 'rm -rf ./definitely-not-here' }))
      .mockResolvedValueOnce(textTurn('ok')));
    const ctx = makeCtx();
    ctx.messages.push({ role: 'user', content: 'clean up' });
    await ctx.agentLoop({ truncateOnError: 1 });
    expect(JSON.parse(ctx.messages.find((m) => m.role === 'tool').content).error).toMatch(/Blocked/);
  });

  it('sends only read-only tools in ask mode and blocks the rest', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(toolCallTurn('write_file', { path: 'x.txt', content: 'x' }))
      .mockResolvedValueOnce(textTurn('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const ui = fakeUi(true);
    const ctx = interactiveCtx(ui);
    ctx.mode = 'ask';
    ctx.messages.push({ role: 'user', content: 'explain' });
    await ctx.agentLoop({ truncateOnError: 1 });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).tools.map((t) => t.function.name);
    expect(sent).toContain('read_file');
    expect(sent).not.toContain('write_file');
    expect(sent).not.toContain('run_shell');
    expect(ui.calls).toHaveLength(0);
    expect(JSON.parse(ctx.messages.find((m) => m.role === 'tool').content).error).toMatch(/not available in ask mode/);
  });

  it('puts retrieved snippets on the latest user turn, not the system prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(textTurn('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const ctx = makeCtx();
    ctx.indexer = { getContextBlock: async () => 'SNIPPET_BODY' };
    ctx.messages.push({ role: 'user', content: 'where is the parser' });
    await ctx.agentLoop({ truncateOnError: 1 });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).messages;
    expect(JSON.stringify(sent[0])).not.toContain('SNIPPET_BODY');
    expect(JSON.stringify(sent.at(-1))).toContain('SNIPPET_BODY');
    expect(ctx.messages[1].content).toBe('where is the parser');
  });

  it('stops after the configured number of tool rounds and says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => toolCallTurn('git_status', {})));
    const logs = [];
    const ui = { ...fakeUi(true), log: (level, text) => logs.push([level, text]) };
    const ctx = interactiveCtx(ui, { max_agent_loops: 2 });
    ctx.messages.push({ role: 'user', content: 'loop' });
    const status = await ctx.agentLoop({ truncateOnError: 1 });
    expect(status).toBe('limit');
    expect(logs.some(([, t]) => /Stopped after 2 tool rounds/.test(t))).toBe(true);
  });

  it('never runs code blocks from an answer, even with shell commands always allowed', async () => {
    const sentinel = `/tmp/aplotita_shblock_${process.pid}`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(textTurn('Usage:\n\n```sh\ntouch ' + sentinel + '\n```\n')));
    const ui = fakeUi(true);
    const ctx = interactiveCtx(ui);
    ctx.alwaysAllow.add('shell');
    ctx.messages.push({ role: 'user', content: 'how do I use it' });
    const status = await ctx.agentLoop({ truncateOnError: 1 });
    expect(status).toBe('done');
    expect(ui.calls).toHaveLength(0);
    const { existsSync } = await import('fs');
    expect(existsSync(sentinel)).toBe(false);
  });

  it('reports token usage once per turn', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(streamResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: 'git_status', arguments: '{}' } }] } }] })}`,
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
        'data: [DONE]',
      ]))
      .mockResolvedValueOnce(streamResponse([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        'data: {"usage":{"prompt_tokens":20,"completion_tokens":3,"total_tokens":23}}',
        'data: [DONE]',
      ])));
    const usage = [];
    const ui = { ...fakeUi(true), usage: (u) => usage.push({ ...u }) };
    const ctx = interactiveCtx(ui);
    ctx.messages.push({ role: 'user', content: 'status?' });
    await ctx.agentLoop({ truncateOnError: 1 });
    expect(usage).toEqual([{ prompt: 30, completion: 5, total: 35, rounds: 2 }]);
  });
});

