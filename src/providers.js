export const PROVIDERS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyPrefix: 'sk-or-',
    keyHint: 'sk-or-v1-...',
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'anthropic/claude-opus-5.5',
    supportsModelsEndpoint: true,
    supportsCacheControl: true,
    supportsRoutingField: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyPrefix: 'sk-',
    keyHint: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-6.1-sol',
    supportsModelsEndpoint: true,
    maxTokensField: 'max_completion_tokens',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyPrefix: 'sk-ant-',
    keyHint: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-opus-5-5',
    supportsModelsEndpoint: false,
    defaultMaxTokens: 32000,
  },
  {
    id: 'google',
    name: 'Google AI (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyPrefix: 'AI',
    keyHint: 'AIza...',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.8-flash',
    supportsModelsEndpoint: false,
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyPrefix: 'gsk_',
    keyHint: 'gsk_...',
    keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile',
    supportsModelsEndpoint: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    keyPrefix: 'sk-',
    keyHint: 'sk-...',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-chat',
    supportsModelsEndpoint: true,
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    keyPrefix: 'xai-',
    keyHint: 'xai-...',
    keyUrl: 'https://console.x.ai/',
    defaultModel: 'grok-4.7',
    supportsModelsEndpoint: true,
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    keyPrefix: '',
    keyHint: 'leave empty if your server needs no key',
    keyUrl: '',
    defaultModel: '',
    supportsModelsEndpoint: true,
    keyOptional: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    keyPrefix: '',
    keyHint: 'Leave empty for local Ollama',
    keyUrl: 'http://localhost:11434',
    defaultModel: 'qwen3',
    supportsModelsEndpoint: true,
    keyOptional: true,
  },
];

export function getProvider(id) {
  return PROVIDERS.find(p => p.id === id) || null;
}

export function detectProviderId(providerId, baseUrl) {
  if (providerId) return providerId;
  const url = String(baseUrl || '');
  const match = PROVIDERS.find(p => p.id !== 'custom' && p.baseUrl && url.startsWith(p.baseUrl));
  return match ? match.id : 'custom';
}

export function providerSupportsCacheControl(id) {
  const provider = getProvider(id);
  return Boolean(provider && provider.supportsCacheControl);
}

export function providerSupportsRoutingField(id) {
  const provider = getProvider(id);
  return Boolean(provider && provider.supportsRoutingField);
}

export function providerOption(id, key) {
  const provider = getProvider(id);
  return provider ? provider[key] : undefined;
}

export function isKeyOptional(opts = {}) {
  return Boolean(providerOption(detectProviderId(opts.provider, opts.baseUrl), 'keyOptional'));
}

export function getProviderChoices() {
  return PROVIDERS.map(p => ({
    value: p.id,
    label: p.name,
    hint: p.id === 'custom' ? 'any OpenAI-compatible API' : p.baseUrl,
  }));
}
