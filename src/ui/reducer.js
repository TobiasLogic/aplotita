// Pure transcript state operations for the Ink TUI.
// A "block" is one entry in the conversation transcript. The controller owns
// id generation; these functions are pure over (state, ...args).

export function initialState() {
  return { blocks: [], status: null, overlay: null };
}

export function addBlock(state, block) {
  return { ...state, blocks: [...state.blocks, block] };
}

export function patchBlock(state, id, patch) {
  return {
    ...state,
    blocks: state.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  };
}

export function setStatus(state, status) {
  return { ...state, status };
}

export function setOverlay(state, overlay) {
  return { ...state, overlay };
}

export function clearBlocks(state) {
  return { ...state, blocks: [] };
}

// Split blocks into a committed prefix (safe for <Static>) and a live tail.
// Everything up to the first not-yet-done block is committed; the rest is live.
export function splitBlocks(blocks) {
  const firstLive = blocks.findIndex((b) => !b.done);
  if (firstLive === -1) return { staticBlocks: blocks, liveBlocks: [] };
  return { staticBlocks: blocks.slice(0, firstLive), liveBlocks: blocks.slice(firstLive) };
}
