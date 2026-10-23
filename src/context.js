import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { resolve, relative } from 'path';
import { simpleGlob } from './glob.js';
import { cachedModel } from './models.js';

const MAX_FILE_SIZE = 50 * 1024;
const MAX_TOTAL_SIZE = 200 * 1024;
const MAX_DIR_ENTRIES = 200;

const VISION_MODEL_HINTS = [
  'gpt-4o', 'gpt-4.1', 'gpt-4-turbo', 'gpt-4-vision', 'chatgpt-4o',
  'o1', 'o3', 'o4-mini',
  'gpt-5', 'gpt-6',
  'claude', 'sonnet', 'opus', 'haiku', 'fable',
  'gemini',
  'pixtral', 'llava', 'vision', 'internvl', 'molmo', 'moondream',
  'llama-3.2', 'llama-4', 'qwen-vl', 'qwen2-vl', 'qwen2.5-vl', 'qvq',
  'grok-2-vision', 'grok-4', 'grok-vision',
];

export function isVisionCapableModel(model) {
  if (!model) return false;
  const known = cachedModel(String(model));
  if (Array.isArray(known?.inputModalities)) return known.inputModalities.includes('image');
  const id = String(model).toLowerCase();
  return VISION_MODEL_HINTS.some((hint) => id.includes(hint));
}

export function expandMentions(text) {
  const mentions = [];
  const regex = /(^|\s)@([^\s@]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const index = match.index + match[1].length;
    mentions.push({ token: '@' + match[2], path: match[2], index });
  }
  return mentions;
}

function locateMention(raw, cwd) {
  const candidates = [raw];
  const trimmed = raw.replace(/[)\],.;:!?'"]+$/, '');
  if (trimmed && trimmed !== raw) candidates.push(trimmed);
  for (const candidate of candidates) {
    if (candidate.includes('*')) {
      const paths = simpleGlob(candidate, cwd).map((p) => relative(cwd, p));
      if (paths.length > 0) return { used: candidate, paths };
      continue;
    }
    if (existsSync(resolve(cwd, candidate))) return { used: candidate, paths: [candidate] };
  }
  return null;
}

function looksIntended(raw, cwd) {
  if (raw.includes('*')) return true;
  const first = raw.split('/')[0];
  return raw.includes('/') && first !== '' && existsSync(resolve(cwd, first));
}

function listDirectory(fullPath) {
  const entries = readdirSync(fullPath, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
  const shown = entries.slice(0, MAX_DIR_ENTRIES);
  if (entries.length > shown.length) shown.push(`... ${entries.length - shown.length} more`);
  return shown.join('\n');
}

export function resolveMentions(text, { cwd = process.cwd(), model } = {}) {
  const mentions = expandMentions(text);
  if (mentions.length === 0) return { text, context: '', images: [], warnings: [] };

  const contextParts = [];
  const images = [];
  const warnings = [];
  const consumed = [];
  let totalSize = 0;
  let limitReached = false;

  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

  for (const mention of mentions) {
    const found = locateMention(mention.path, cwd);
    if (!found) {
      if (looksIntended(mention.path, cwd)) {
        warnings.push(`Nothing matches ${mention.token}; it was sent as plain text.`);
      }
      continue;
    }
    consumed.push(mention.index);
    if (limitReached) continue;

    for (const pathStr of found.paths) {
      if (limitReached) break;

      const fullPath = resolve(cwd, pathStr);
      const relPath = relative(cwd, fullPath) || '.';

      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          contextParts.push(`--- ${relPath}/ (directory listing) ---\n${listDirectory(fullPath)}\n--- end ${relPath}/ ---`);
          continue;
        }

        const ext = (relPath.match(/\.[^.]+$/) || [''])[0].toLowerCase();
        if (imageExts.has(ext)) {
          const mimeType = ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
          const base64 = readFileSync(fullPath, 'base64');
          images.push({
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` }
          });
          totalSize += base64.length;
          if (totalSize > MAX_TOTAL_SIZE) {
            contextParts.push(`[Total context limit reached, remaining files skipped]`);
            limitReached = true;
          }
          continue;
        }

        if (stat.size > MAX_FILE_SIZE) {
          const content = readFileSync(fullPath, 'utf-8').slice(0, MAX_FILE_SIZE);
          contextParts.push(`--- ${relPath} (truncated at ${MAX_FILE_SIZE} bytes) ---\n${content}\n--- end ${relPath} ---`);
          totalSize += MAX_FILE_SIZE;
        } else {
          const content = readFileSync(fullPath, 'utf-8');
          contextParts.push(`--- ${relPath} ---\n${content}\n--- end ${relPath} ---`);
          totalSize += content.length;
        }
      } catch (err) {
        warnings.push(`Could not read ${pathStr}: ${err.message}`);
      }

      if (totalSize > MAX_TOTAL_SIZE) {
        contextParts.push(`[Total context limit reached, remaining files skipped]`);
        limitReached = true;
      }
    }
  }

  let cleanText = text;
  for (const index of consumed.slice().reverse()) {
    cleanText = cleanText.slice(0, index) + cleanText.slice(index + 1);
  }
  cleanText = cleanText.replace(/[ \t]{2,}/g, ' ').trim();

  const context = contextParts.length > 0
    ? '\n\nAttached file contents:\n\n' + contextParts.join('\n\n')
    : '';

  if (images.length > 0 && !isVisionCapableModel(model)) {
    warnings.push(`Attached ${images.length} image(s) but "${model || 'the active model'}" may not accept image input; they could be ignored.`);
  }

  return { text: cleanText, context, images, warnings };
}
