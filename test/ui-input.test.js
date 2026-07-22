import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { html } from '../src/ui/html.js';
import { Input } from '../src/ui/components/Input.js';
import { ApprovalOverlay } from '../src/ui/components/ApprovalOverlay.js';
import { SelectOverlay } from '../src/ui/components/SelectOverlay.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '');
const DOWN = '[B';

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
});
