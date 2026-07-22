import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';

export const HISTORY_FILE = join(CONFIG_DIR, 'history.json');

export function saveHistory(messages) {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(HISTORY_FILE, JSON.stringify(messages, null, 2), 'utf-8');
  } catch {}
}

export function loadHistory() {
  try {
    const parsed = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
    if (Array.isArray(parsed) &&
        parsed.every(m => m && typeof m.role === 'string' && (typeof m.content === 'string' || Array.isArray(m.content)))) {
      return parsed;
    }
  } catch {}
  return null;
}
