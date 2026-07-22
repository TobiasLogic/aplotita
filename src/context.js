import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import { simpleGlob } from './glob.js';

const MAX_FILE_SIZE = 50 * 1024;
const MAX_TOTAL_SIZE = 200 * 1024;

const VISION_MODEL_HINTS = [
  'gpt-4o', 'gpt-4.1', 'gpt-4-turbo', 'gpt-4-vision', 'chatgpt-4o',
  'o1', 'o3', 'o4-mini',
  'claude-3', 'claude-4', 'claude-sonnet', 'claude-opus', 'claude-haiku',
  'sonnet', 'opus', 'haiku',
  'gemini',
  'pixtral', 'llava', 'vision', 'internvl', 'molmo', 'moondream',
  'llama-3.2', 'llama-4', 'qwen-vl', 'qwen2-vl', 'qwen2.5-vl', 'qvq',
  'grok-2-vision', 'grok-4', 'grok-vision',
];

export function isVisionCapableModel(model) {
  if (!model) return false;
  const id = String(model).toLowerCase();
  return VISION_MODEL_HINTS.some((hint) => id.includes(hint));
}

export function expandMentions(text) {
  const mentions = [];
  const regex = /@([^\s@]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    mentions.push({ token: match[0], path: match[1], index: match.index });
  }
  return mentions;
}

export function resolveMentions(text, { cwd = process.cwd(), model } = {}) {
  const mentions = expandMentions(text);
  if (mentions.length === 0) return { text, context: '', images: [], warnings: [] };

  let contextParts = [];
  let images = [];
  let warnings = [];
  let totalSize = 0;
  let cleanText = text;
  let limitReached = false;

  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

  for (const mention of mentions) {
    if (limitReached) break;

    let paths = [mention.path];
    if (mention.path.includes('*')) {
      paths = simpleGlob(mention.path, cwd).map(p => relative(cwd, p));
      if (paths.length === 0) {
        contextParts.push(`[No files matched: ${mention.path}]`);
        continue;
      }
    }

    for (const pathStr of paths) {
      if (limitReached) break;

      const fullPath = resolve(cwd, pathStr);
      const relPath = relative(cwd, fullPath);

      if (!existsSync(fullPath)) {
        contextParts.push(`[File not found: ${pathStr}]`);
        continue;
      }

      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          contextParts.push(`[${pathStr} is a directory, not a file]`);
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
        contextParts.push(`[Error reading ${pathStr}: ${err.message}]`);
      }

      if (totalSize > MAX_TOTAL_SIZE) {
        contextParts.push(`[Total context limit reached, remaining files skipped]`);
        limitReached = true;
      }
    }
  }

  cleanText = cleanText.replace(/@[^\s@]+/g, '').replace(/\s{2,}/g, ' ').trim();

  const context = contextParts.length > 0
    ? '\n\nAttached file contents:\n\n' + contextParts.join('\n\n')
    : '';

  if (images.length > 0 && !isVisionCapableModel(model)) {
    warnings.push(`Attached ${images.length} image(s) but "${model || 'the active model'}" may not accept image input; they could be ignored.`);
  }

  return { text: cleanText, context, images, warnings };
}
