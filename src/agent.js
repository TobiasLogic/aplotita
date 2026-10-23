export function accumulateToolCalls(existing, fragments) {
  for (const frag of fragments) {
    const idx = frag.index;
    if (!existing[idx]) {
      existing[idx] = { id: frag.id || '', type: 'function', function: { name: '', arguments: '' } };
    }
    if (frag.id) existing[idx].id = frag.id;
    if (frag.function?.name) existing[idx].function.name += frag.function.name;
    if (frag.function?.arguments) existing[idx].function.arguments += frag.function.arguments;
  }
  return existing;
}

export function assistantMessageWithToolCalls(fullResponse, toolCalls) {
  return {
    role: 'assistant',
    content: fullResponse || null,
    tool_calls: toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
  };
}

export function truncateMessagesOnError(messages, truncateOnError) {
  if (truncateOnError == null) return;
  if (messages.slice(truncateOnError + 1).some((m) => m?.role === 'tool')) return;
  messages.splice(truncateOnError);
}

export async function runAgentLoop(step, maxLoops, signal) {
  for (let i = 0; i < maxLoops; i++) {
    if (signal?.aborted) return 'aborted';
    const result = await step(i);
    if (result !== 'continue') return signal?.aborted ? 'aborted' : 'done';
  }
  return 'limit';
}

function toolMessage(id, payload) {
  return { role: 'tool', tool_call_id: id, content: JSON.stringify(payload) };
}

export async function executeToolCalls(toolCalls, { confirm, isMcpTool, executeMcpTool, executeTool, onResult, onLog, signal }) {
  for (const tc of toolCalls) {
    if (signal?.aborted) {
      onResult(toolMessage(tc.id, { error: 'Interrupted by the user before this ran.' }));
      continue;
    }

    let args;
    try {
      args = JSON.parse(tc.function.arguments || '{}');
    } catch {
      onResult(toolMessage(tc.id, { error: 'Invalid arguments' }));
      continue;
    }

    const decision = await confirm(tc.function.name, args);
    if (decision !== true) {
      const error = typeof decision === 'string' ? decision : 'User rejected this action';
      onResult(toolMessage(tc.id, { error }));
      if (onLog) onLog({ name: tc.function.name, args, rejected: true, reason: typeof decision === 'string' ? decision : undefined });
      continue;
    }

    const result = isMcpTool(tc.function.name)
      ? await executeMcpTool(tc.function.name, args)
      : await executeTool(tc.function.name, args, { signal });

    onResult(toolMessage(tc.id, result));
    if (onLog) onLog({ name: tc.function.name, args, result });
  }
}
