import { useState, useEffect } from 'react';
import { Box, Static, render, useInput } from 'ink';
import { html } from './html.js';
import { splitBlocks } from './reducer.js';
import { Block } from './components/Block.js';
import { Spinner } from './components/Spinner.js';
import { Input } from './components/Input.js';
import { StatusBar } from './components/StatusBar.js';
import { ApprovalOverlay } from './components/ApprovalOverlay.js';
import { SelectOverlay } from './components/SelectOverlay.js';

export function App({ ctx, controller, onSubmit, onExit }) {
  const [state, setState] = useState(controller.getState());
  const [mode, setMode] = useState(ctx.mode);
  const [busy, setBusy] = useState(false);

  useEffect(() => controller.subscribe(setState), [controller]);

  const submit = async (text) => {
    const t = (text || '').trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onSubmit(t);
    } finally {
      setBusy(false);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (busy) process.emit('SIGINT');
      else onExit();
    }
  });

  const { staticBlocks, liveBlocks } = splitBlocks(state.blocks);
  const overlay = state.overlay;

  return html`<${Box} flexDirection="column">
    <${Static} items=${staticBlocks}>
      ${(b) => html`<${Block} key=${b.id} block=${b} />`}
    </${Static}>
    <${Box} flexDirection="column">
      ${liveBlocks.map((b) => html`<${Block} key=${b.id} block=${b} />`)}
    </${Box}>
    ${state.status ? html`<${Spinner} label=${state.status} />` : null}
    ${overlay
      ? (overlay.kind === 'approval'
          ? html`<${ApprovalOverlay} payload=${overlay.payload} onResolve=${overlay.resolve} />`
          : html`<${SelectOverlay} payload=${overlay.payload} onResolve=${overlay.resolve} />`)
      : html`<${Box} flexDirection="column" marginTop=${1}>
          <${Input} mode=${mode} disabled=${busy} onSubmit=${submit}
            onModeChange=${(m) => { ctx.mode = m; setMode(m); }} />
          <${StatusBar} ctx=${ctx} mode=${mode} />
        </${Box}>`}
  </${Box}>`;
}

export function mountInkApp(ctx, { onSubmit, onExit }) {
  const controller = ctx.ui;
  let instance = null;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  const handle = { done };

  function element() {
    return html`<${App} ctx=${ctx} controller=${controller}
      onSubmit=${onSubmit} onExit=${() => onExit()} />`;
  }
  function mount() {
    instance = render(element(), { exitOnCtrlC: false });
  }

  const resetBlocks = controller.clear;
  controller.clear = () => { resetBlocks(); if (instance) instance.clear(); };

  handle.finish = () => resolveDone();
  handle.unmount = () => { if (instance) instance.unmount(); };
  handle.suspend = async (fn) => {
    if (instance) {
      instance.unmount();
      await instance.waitUntilExit();
      instance = null;
    }
    try {
      return await fn();
    } finally {
      mount();
    }
  };

  mount();
  controller.suspend = handle.suspend;
  return handle;
}
