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
  if (truncateOnError != null) messages.splice(truncateOnError);
}

export async function runAgentLoop(step, maxLoops) {
  for (let i = 0; i < maxLoops; i++) {
    const result = await step(i);
    if (result !== 'continue') break;
  }
}

export async function executeToolCalls(toolCalls, { confirm, isMcpTool, executeMcpTool, executeTool, onResult, onLog }) {
  for (const tc of toolCalls) {
    let args;
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      onResult({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'Invalid arguments' }) });
      continue;
    }

    const approved = await confirm(tc.function.name, args);
    if (!approved) {
      onResult({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'User rejected this action' }) });
      if (onLog) onLog({ name: tc.function.name, rejected: true });
      continue;
    }

    const result = isMcpTool(tc.function.name)
      ? await executeMcpTool(tc.function.name, args)
      : await executeTool(tc.function.name, args);

    onResult({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    if (onLog) onLog({ name: tc.function.name, result });
  }
}
