import { describe, it, expect, afterEach } from 'vitest';
import { themeOptions, setTheme, currentTheme, accent } from '../src/ui/theme.js';

afterEach(() => setTheme('teal'));

describe('ui theme', () => {
  it('offers the named accents', () => {
    const labels = themeOptions().map((o) => o.label);
    expect(labels).toEqual([
      'Aplótita Teal', 'Night Blue', 'Desert Red', 'Rust Orange', 'Pear Green',
    ]);
  });

  it('setTheme switches the active accent', () => {
    const t = setTheme('night');
    expect(t.value).toBe('night');
    expect(currentTheme().label).toBe('Night Blue');
    expect(accent()).toBe('#3B6EA5');
  });

  it('ignores unknown values and keeps the current theme', () => {
    setTheme('desert');
    setTheme('nope');
    expect(currentTheme().value).toBe('desert');
  });

  it('every option maps to a hex accent', () => {
    for (const o of themeOptions()) {
      const t = setTheme(o.value);
      expect(t.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
