import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { CONFIG_DIR } from './config.js';

const CACHE_FILE = join(CONFIG_DIR, 'models.json');
const CACHE_TTL = 60 * 60 * 1000;

function cacheKey(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

export async function fetchModels(baseUrl, apiKey, signal) {
  const key = cacheKey(baseUrl);
  const entry = loadCache()[key];
  if (entry && Array.isArray(entry.models) && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.models;
  }

  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${key}/models`, { headers, signal });

  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);

  const data = await res.json();
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const models = list
    .filter((m) => m && m.id)
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      contextLength: m.context_length || null,
      pricing: m.pricing || null,
      inputModalities: Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  saveCache(key, models);
  return models;
}

function loadCache() {
  try {
    if (!existsSync(CACHE_FILE)) return {};
    const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed.models)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveCache(key, models) {
  try {
    const all = loadCache();
    all[key] = { models, timestamp: Date.now() };
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(all), 'utf-8');
  } catch {}
}

export function cachedModel(modelId, baseUrl) {
  if (!modelId) return null;
  const all = loadCache();
  const preferred = all[cacheKey(baseUrl)];
  const entries = preferred ? [preferred, ...Object.values(all)] : Object.values(all);
  for (const entry of entries) {
    const m = Array.isArray(entry?.models) ? entry.models.find((x) => x.id === modelId) : null;
    if (m) return m;
  }
  return null;
}

export function cachedContextLength(modelId, baseUrl) {
  const m = cachedModel(modelId, baseUrl);
  return m && m.contextLength ? m.contextLength : null;
}

export function formatModelList(models) {
  return models.map(m => {
    const ctx = m.contextLength ? `${(m.contextLength / 1000).toFixed(0)}k ctx` : '';
    const price = m.pricing?.prompt ? `$${(parseFloat(m.pricing.prompt) * 1000000).toFixed(2)}/M` : '';
    return `${m.id}  ${ctx}  ${price}`.trim();
  });
}

export function modelOptions(models) {
  return models.map((m) => ({
    value: m.id,
    label: m.id,
    hint: m.contextLength ? `${(m.contextLength / 1000).toFixed(0)}k ctx` : '',
  }));
}
