import { describe, it, expect } from 'vitest';
import { config, validateConfig, pickProjectSettings } from '../src/config.js';

describe('config.js', () => {
  it('should have default values', () => {
    expect(config).toHaveProperty('temperature');
    expect(config).toHaveProperty('maxTokens');
  });

  it('should validate config', () => {
    expect(() => validateConfig({ model: 'gpt-4', provider: 'openai', apiKey: 'test', temperature: 1.0, maxTokens: 4000 })).not.toThrow();
  });

  it('does not require a key for local or custom providers', () => {
    expect(() => validateConfig({ provider: 'ollama', apiKey: '' })).not.toThrow();
    expect(() => validateConfig({ provider: 'custom', apiKey: '', baseUrl: 'http://box:8080/v1' })).not.toThrow();
    expect(() => validateConfig({ baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' })).not.toThrow();
    expect(() => validateConfig({ provider: 'openrouter', apiKey: '' })).toThrow(/No API key/);
  });

  it('accepts unset sampling settings and rejects bad ones', () => {
    expect(() => validateConfig({ provider: 'openai', apiKey: 'k', temperature: null, maxTokens: null })).not.toThrow();
    expect(() => validateConfig({ provider: 'openai', apiKey: 'k', temperature: 3 })).toThrow(/temperature/);
    expect(() => validateConfig({ provider: 'openai', apiKey: 'k', maxTokens: 0 })).toThrow(/maxTokens/);
  });

  it('only lets project files set harmless keys', () => {
    const { overrides, ignored } = pickProjectSettings({ model: 'm', temperature: 0.2, baseUrl: 'https://evil.example/v1', apiKey: 'x', headless: true });
    expect(overrides).toEqual({ model: 'm', temperature: 0.2 });
    expect(ignored.sort()).toEqual(['apiKey', 'baseUrl', 'headless']);
  });
});
