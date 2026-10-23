import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { html } from '../src/ui/html.js';
import { Input } from '../src/ui/components/Input.js';
import { ApprovalOverlay } from '../src/ui/components/ApprovalOverlay.js';
import { SelectOverlay } from '../src/ui/components/SelectOverlay.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '');
const DOWN = '[B';
const UP = '[A';

describe('Input component', () => {
  it('Tab cycles the mode and Enter submits the typed value', async () => {
    let submitted = null;
    let mode = 'build';
    const { stdin } = render(html`<${Input} mode=${mode} disabled=${false}
      onSubmit=${(v) => { submitted = v; }} onModeChange=${(m) => { mode = m; }} />`);
    await sleep(20);

    stdin.write('\t');
    await sleep(10);
    expect(mode).toBe('architect');

    stdin.write('hi there');
    await sleep(10);
    stdin.write('\r');
    await sleep(10);
    expect(submitted).toBe('hi there');
  });

  it('does not accept input while disabled', async () => {
    let submitted = null;
    const { stdin } = render(html`<${Input} mode=${'build'} disabled=${true}
      onSubmit=${(v) => { submitted = v; }} onModeChange=${() => {}} />`);
    await sleep(20);
    stdin.write('nope');
    stdin.write('\r');
    await sleep(10);
    expect(submitted).toBe(null);
  });
});

describe('Input editing', () => {
  function mount() {
    const submitted = [];
    const r = render(html`<${Input} mode=${'build'} disabled=${false}
      onSubmit=${(v) => submitted.push(v)} onModeChange=${() => {}} />`);
    return { ...r, submitted };
  }

  it('keeps line breaks in a multi-line paste', async () => {
    const { stdin, submitted } = mount();
    await sleep(20);
    stdin.write('first line\rsecond line\r\nthird line');
    await sleep(10);
    stdin.write('\r');
    await sleep(10);
    expect(submitted).toEqual(['first line\nsecond line\nthird line']);
  });

  it('keeps line breaks in a bracketed paste', async () => {
    const { stdin, submitted } = mount();
    await sleep(20);
    stdin.write('\u001b[200~a\nb\u001b[201~');
    await sleep(10);
    stdin.write('\r');
    await sleep(10);
    expect(submitted).toEqual(['a\nb']);
  });

  it('inserts a new line on Alt+Enter instead of sending', async () => {
    const { stdin, submitted } = mount();
    await sleep(20);
    stdin.write('top');
    await sleep(5);
    stdin.write('\u001b\r');
    await sleep(5);
    stdin.write('bottom');
    await sleep(5);
    stdin.write('\r');
    await sleep(10);
    expect(submitted).toEqual(['top\nbottom']);
  });

  it('recalls earlier prompts with the up arrow', async () => {
    const { stdin, submitted } = mount();
    await sleep(20);
    stdin.write('one');
    await sleep(5);
    stdin.write('\r');
    await sleep(5);
    stdin.write('two');
    await sleep(5);
    stdin.write('\r');
    await sleep(5);
    stdin.write(UP);
    await sleep(5);
    stdin.write(UP);
    await sleep(5);
    stdin.write('\r');
    await sleep(10);
    expect(submitted).toEqual(['one', 'two', 'one']);
  });

  it('clears the line with Ctrl+U and deletes a word with Ctrl+W', async () => {
    const { stdin, submitted } = mount();
    await sleep(20);
    stdin.write('throw away');
    await sleep(5);
    stdin.write('\u0015');
    await sleep(5);
    stdin.write('keep this word');
    await sleep(5);
    stdin.write('\u0017');
    await sleep(5);
    stdin.write('\r');
    await sleep(10);
    expect(submitted).toEqual(['keep this ']);
  });
});

describe('ApprovalOverlay component', () => {
  it('resolves true on y and false on n', async () => {
    let a = null;
    const r1 = render(html`<${ApprovalOverlay} payload=${{ verb: 'WRITE', target: 'f' }} onResolve=${(v) => { a = v; }} />`);
    await sleep(20);
    expect(strip(r1.lastFrame())).toMatch(/WRITE/);
    r1.stdin.write('y');
    await sleep(10);
    expect(a).toBe(true);

    let b = null;
    const r2 = render(html`<${ApprovalOverlay} payload=${{ verb: 'EDIT', target: 'f' }} onResolve=${(v) => { b = v; }} />`);
    await sleep(20);
    r2.stdin.write('n');
    await sleep(10);
    expect(b).toBe(false);
  });

  it('offers "always" only when allowed and never for dangerous commands', async () => {
    let a = null;
    const r1 = render(html`<${ApprovalOverlay} payload=${{ verb: 'SHELL', target: 'ls', allowAlways: true }} onResolve=${(v) => { a = v; }} />`);
    await sleep(20);
    expect(strip(r1.lastFrame())).toMatch(/always this session/);
    r1.stdin.write('a');
    await sleep(10);
    expect(a).toBe('always');

    let b = null;
    const r2 = render(html`<${ApprovalOverlay} payload=${{ verb: 'RUN', target: 'rm -rf /', danger: true, allowAlways: true }} onResolve=${(v) => { b = v; }} />`);
    await sleep(20);
    expect(strip(r2.lastFrame())).not.toMatch(/always/);
    r2.stdin.write('a');
    await sleep(10);
    expect(b).toBe(null);
  });
});

describe('SelectOverlay component', () => {
  it('moves with arrows and resolves the highlighted value', async () => {
    let picked;
    const { stdin, lastFrame } = render(html`<${SelectOverlay}
      payload=${{ message: 'Pick', options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] }}
      onResolve=${(v) => { picked = v; }} />`);
    await sleep(20);
    expect(strip(lastFrame())).toMatch(/Alpha/);
    stdin.write(DOWN);
    await sleep(10);
    stdin.write('\r');
    await sleep(10);
    expect(picked).toBe('b');
  });

  it('filters long lists as you type', async () => {
    let picked;
    const options = ['openai/gpt-6.1-sol', 'anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'qwen/qwen3.8-flash']
      .map((id) => ({ value: id, label: id }));
    const { stdin, lastFrame } = render(html`<${SelectOverlay}
      payload=${{ message: 'Pick', options, filterable: true }}
      onResolve=${(v) => { picked = v; }} />`);
    await sleep(20);
    stdin.write('sonnet');
    await sleep(10);
    expect(strip(lastFrame())).toMatch(/1\/4/);
    stdin.write('\r');
    await sleep(10);
    expect(picked).toBe('anthropic/claude-sonnet-5.5');
  });

  it('starts on the initial index', async () => {
    let picked;
    const { stdin } = render(html`<${SelectOverlay}
      payload=${{ message: 'Pick', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], initialIndex: 1 }}
      onResolve=${(v) => { picked = v; }} />`);
    await sleep(20);
    stdin.write('\r');
    await sleep(10);
    expect(picked).toBe('b');
  });
});
