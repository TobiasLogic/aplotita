import { readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { CONFIG_DIR, writePrivateFile } from './config.js';

export const HISTORY_DIR = join(CONFIG_DIR, 'history');

export function historyFile(cwd = process.cwd()) {
  const id = createHash('sha1').update(cwd).digest('hex').slice(0, 12);
  const name = basename(cwd).replace(/[^\w.-]/g, '_') || 'root';
  return join(HISTORY_DIR, `${name}-${id}.json`);
}

export function saveHistory(messages, cwd = process.cwd()) {
  try {
    writePrivateFile(historyFile(cwd), JSON.stringify(messages), HISTORY_DIR);
  } catch {}
}

export function loadHistory(cwd = process.cwd()) {
  try {
    const file = historyFile(cwd);
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    if (Array.isArray(parsed) &&
        parsed.every(m => m && typeof m.role === 'string' && (typeof m.content === 'string' || Array.isArray(m.content) || m.content === null))) {
      return parsed;
    }
  } catch {}
  return null;
}
