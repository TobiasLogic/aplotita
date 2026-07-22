import { describe, it, expect, vi } from 'vitest';
import {
  accumulateToolCalls, assistantMessageWithToolCalls, truncateMessagesOnError,
  runAgentLoop, executeToolCalls,
} from '../src/agent.js';

describe('accumulateToolCalls', () => {
  it('assembles a tool call streamed across fragments', () => {
    const acc = [];
    accumulateToolCalls(acc, [{ index: 0, id: 'call_1', function: { name: 'read_', arguments: '{"pa' } }]);
    accumulateToolCalls(acc, [{ index: 0, function: { name: 'file', arguments: 'th":"a.js"}' } }]);
    expect(acc[0]).toEqual({
      id: 'call_1', type: 'function',
      function: { name: 'read_file', arguments: '{"path":"a.js"}' },
    });
  });

  it('tracks multiple tool calls by index', () => {
    const acc = [];
    accumulateToolCalls(acc, [
      { index: 0, id: 'a', function: { name: 'x', arguments: '' } },
      { index: 1, id: 'b', function: { name: 'y', arguments: '' } },
    ]);
    expect(acc).toHaveLength(2);
    expect(acc[1].id).toBe('b');
  });
});

describe('assistantMessageWithToolCalls', () => {
  it('sets content to null when there was no text', () => {
    const msg = assistantMessageWithToolCalls('', [{ id: '1', function: { name: 'f', arguments: '{}' } }]);
    expect(msg.content).toBe(null);
    expect(msg.tool_calls[0]).toEqual({ id: '1', type: 'function', function: { name: 'f', arguments: '{}' } });
  });

  it('keeps preceding assistant text', () => {
    const msg = assistantMessageWithToolCalls('let me check', [{ id: '1', function: { name: 'f', arguments: '{}' } }]);
    expect(msg.content).toBe('let me check');
  });
});

describe('truncateMessagesOnError', () => {
  it('truncates from the given index', () => {
    const messages = [{ a: 1 }, { a: 2 }, { a: 3 }];
    truncateMessagesOnError(messages, 1);
    expect(messages).toHaveLength(1);
  });

  it('is a no-op when the index is null', () => {
    const messages = [{ a: 1 }, { a: 2 }];
    truncateMessagesOnError(messages, null);
    expect(messages).toHaveLength(2);
  });
});

describe('runAgentLoop', () => {
  it('stops as soon as a step does not return "continue"', async () => {
    const step = vi.fn()
      .mockResolvedValueOnce('continue')
      .mockResolvedValueOnce('continue')
      .mockResolvedValueOnce(undefined);
    await runAgentLoop(step, 10);
    expect(step).toHaveBeenCalledTimes(3);
  });

  it('never exceeds maxLoops even if the step keeps continuing', async () => {
    const step = vi.fn().mockResolvedValue('continue');
    await runAgentLoop(step, 4);
    expect(step).toHaveBeenCalledTimes(4);
  });
});

describe('executeToolCalls', () => {
  function deps(overrides = {}) {
    const results = [];
    return {
      results,
      confirm: vi.fn().mockResolvedValue(true),
      isMcpTool: vi.fn().mockReturnValue(false),
      executeMcpTool: vi.fn().mockResolvedValue({ success: true, from: 'mcp' }),
      executeTool: vi.fn().mockResolvedValue({ success: true, from: 'local' }),
      onResult: (m) => results.push(m),
      onLog: vi.fn(),
      ...overrides,
    };
  }

  it('records an error result for invalid arguments without executing', async () => {
    const d = deps();
    await executeToolCalls([{ id: '1', function: { name: 'read_file', arguments: '{bad json' } }], d);
    expect(d.executeTool).not.toHaveBeenCalled();
    expect(d.confirm).not.toHaveBeenCalled();
    expect(JSON.parse(d.results[0].content)).toEqual({ error: 'Invalid arguments' });
  });

  it('records a rejection result and does not execute when not approved', async () => {
    const d = deps({ confirm: vi.fn().mockResolvedValue(false) });
    await executeToolCalls([{ id: '1', function: { name: 'write_file', arguments: '{}' } }], d);
    expect(d.executeTool).not.toHaveBeenCalled();
    expect(JSON.parse(d.results[0].content)).toEqual({ error: 'User rejected this action' });
    expect(d.onLog).toHaveBeenCalledWith({ name: 'write_file', rejected: true });
  });

  it('runs a local tool and pushes its result', async () => {
    const d = deps();
    await executeToolCalls([{ id: '1', function: { name: 'list_dir', arguments: '{}' } }], d);
    expect(d.executeTool).toHaveBeenCalledWith('list_dir', {});
    expect(d.executeMcpTool).not.toHaveBeenCalled();
    expect(JSON.parse(d.results[0].content)).toEqual({ success: true, from: 'local' });
    expect(d.results[0].tool_call_id).toBe('1');
  });

  it('routes MCP tools to the MCP executor', async () => {
    const d = deps({ isMcpTool: vi.fn().mockReturnValue(true) });
    await executeToolCalls([{ id: '9', function: { name: 'mcp__srv__do', arguments: '{}' } }], d);
    expect(d.executeMcpTool).toHaveBeenCalledWith('mcp__srv__do', {});
    expect(d.executeTool).not.toHaveBeenCalled();
    expect(JSON.parse(d.results[0].content)).toEqual({ success: true, from: 'mcp' });
  });

  it('preserves order across a mix of tool calls', async () => {
    const d = deps();
    await executeToolCalls([
      { id: 'a', function: { name: 'list_dir', arguments: '{}' } },
      { id: 'b', function: { name: 'read_file', arguments: 'oops' } },
    ], d);
    expect(d.results.map((r) => r.tool_call_id)).toEqual(['a', 'b']);
    expect(JSON.parse(d.results[1].content)).toEqual({ error: 'Invalid arguments' });
  });
});
