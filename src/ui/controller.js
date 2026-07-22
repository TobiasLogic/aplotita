import { EventEmitter } from 'node:events';
import * as R from './reducer.js';

// The Ink-facing UI controller. Session/commands/tools call these methods
// instead of writing to stdout; the Ink <App> subscribes to 'update' and
// re-renders from getState(). Interactive requests return promises that
// resolve when the user answers an overlay.
export function createInkController() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  let state = R.initialState();
  let idc = 0;
  const nextId = () => `b${++idc}`;

  function set(next) {
    state = next;
    emitter.emit('update', state);
  }
  function add(block) {
    const id = nextId();
    set(R.addBlock(state, { id, done: true, ...block }));
    return id;
  }
  function patch(id, p) {
    set(R.patchBlock(state, id, p));
  }
  function textOf(id) {
    const b = state.blocks.find((x) => x.id === id);
    return b ? (b.text || '') : '';
  }
  function outOf(id) {
    const b = state.blocks.find((x) => x.id === id);
    return b ? (b.out || '') : '';
  }

  let shellId = null;

  const ui = {
    isInk: true,

    subscribe(fn) {
      emitter.on('update', fn);
      return () => emitter.off('update', fn);
    },
    getState() {
      return state;
    },

    userMessage(text) {
      add({ type: 'user', text });
    },
    note(text, extra = {}) {
      add({ type: 'note', text, ...extra });
    },
    log(level, text) {
      add({ type: 'log', level, text });
    },
    usage(u) {
      add({ type: 'usage', ...u });
    },
    separator() {
      add({ type: 'separator' });
    },

    startAssistant() {
      const id = nextId();
      set(R.addBlock(state, { id, type: 'assistant', text: '', done: false }));
      return {
        appendDelta(t) {
          patch(id, { text: textOf(id) + t });
        },
        done() {
          patch(id, { done: true });
        },
      };
    },

    setStatus(label) {
      set(R.setStatus(state, label));
    },

    toolResult({ name, result, rejected }) {
      add({ type: 'tool', name, result, rejected: !!rejected });
    },

    shellStart(cmd) {
      const id = nextId();
      shellId = id;
      set(R.addBlock(state, { id, type: 'shell', cmd, out: '', done: false }));
    },
    shellChunk(text, isErr) {
      if (shellId) patch(shellId, { out: outOf(shellId) + text, hasErr: isErr || undefined });
    },
    shellEnd(result) {
      if (shellId) patch(shellId, { done: true, result });
      shellId = null;
    },

    banner(opts) {
      add({ type: 'banner', opts });
    },
    help() {
      add({ type: 'help' });
    },
    sessionStats(stats) {
      add({ type: 'stats', stats });
    },
    wordmark() {
      add({ type: 'wordmark' });
    },

    requestApproval(payload) {
      return new Promise((resolve) => {
        set(R.setOverlay(state, {
          kind: 'approval',
          payload,
          resolve: (v) => {
            set(R.setOverlay(state, null));
            resolve(v);
          },
        }));
      });
    },
    requestSelect(payload) {
      return new Promise((resolve) => {
        set(R.setOverlay(state, {
          kind: 'select',
          payload,
          resolve: (v) => {
            set(R.setOverlay(state, null));
            resolve(v);
          },
        }));
      });
    },

    clear() {
      set(R.clearBlocks(state));
    },

    // Replaced by the app with a real Ink-pause implementation; default awaits.
    async suspend(fn) {
      return await fn();
    },
  };

  return ui;
}
