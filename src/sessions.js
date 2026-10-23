import { readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR, writePrivateFile } from './config.js';

const SESSIONS_DIR = join(CONFIG_DIR, 'sessions');

export function isValidSessionName(name) {
  return typeof name === 'string' && /^[\w][\w.-]{0,99}$/.test(name);
}

function sessionPath(name) {
  if (!isValidSessionName(name)) return null;
  return join(SESSIONS_DIR, `${name}.json`);
}

function ensureDir() {
  mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
}

export function listSessions() {
  ensureDir();
  try {
    return readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const name = f.replace(/\.json$/, '');
        const stat = statSync(join(SESSIONS_DIR, f));
        return { name, modified: stat.mtime, size: stat.size };
      })
      .sort((a, b) => b.modified - a.modified);
  } catch {
    return [];
  }
}

export function saveSession(name, messages) {
  const path = sessionPath(name);
  if (!path) throw new Error(`Invalid session name: ${name}`);
  writePrivateFile(path, JSON.stringify(messages, null, 2), SESSIONS_DIR);
  return path;
}

export function loadSession(name) {
  const path = sessionPath(name);
  if (!path || !existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (Array.isArray(parsed) && parsed.every(m => m && typeof m.role === 'string')) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function deleteSession(name) {
  const path = sessionPath(name);
  if (!path || !existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function sessionExists(name) {
  const path = sessionPath(name);
  return Boolean(path && existsSync(path));
}
