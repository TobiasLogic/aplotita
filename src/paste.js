export function createPasteState() {
  return { active: false, buffer: '' };
}

export function feedPasteKey(state, str, key) {
  const name = key && key.name;
  if (name === 'paste-start') {
    state.active = true;
    state.buffer = '';
    return { type: 'start' };
  }
  if (name === 'paste-end') {
    if (!state.active) return { type: 'passthrough' };
    state.active = false;
    const text = state.buffer;
    state.buffer = '';
    return { type: 'end', text };
  }
  if (state.active) {
    state.buffer += name === 'return' ? '\n' : (str == null ? '' : str);
    return { type: 'accumulate' };
  }
  return { type: 'passthrough' };
}

export function insertPaste(line, cursor, text) {
  const at = Math.max(0, Math.min(cursor, line.length));
  const before = line.slice(0, at);
  const after = line.slice(at);
  return { line: before + text + after, cursor: before.length + text.length };
}
