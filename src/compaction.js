import { estimateMessageTokens, estimateMessagesTokens } from './tokens.js';

export function stripImagesForSummary(messages) {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const texts = [];
    let hadImage = false;
    for (const part of m.content) {
      if (part && (part.type === 'image_url' || part.type === 'image')) hadImage = true;
      else if (part && typeof part.text === 'string') texts.push(part.text);
      else if (typeof part === 'string') texts.push(part);
    }
    let content = texts.join('\n');
    if (hadImage) content = content ? `${content}\n[image omitted]` : '[image omitted]';
    return { ...m, content };
  });
}

export function lastUserIndex(messages) {
  for (let i = messages.length - 1; i >= 1; i--) {
    if (messages[i] && messages[i].role === 'user') return i;
  }
  return -1;
}

export function planEviction(messages, { low, currentTokens, force = false }) {
  const lui = lastUserIndex(messages);
  let splitIdx = 1;
  if (force) {
    splitIdx = lui > 1 ? lui : 1;
  } else {
    let projected = currentTokens;
    while (splitIdx < messages.length && projected > low) {
      projected -= estimateMessageTokens(messages[splitIdx]);
      splitIdx++;
    }
    if (lui > 0) splitIdx = Math.min(splitIdx, lui);
  }
  while (splitIdx < messages.length && messages[splitIdx] && messages[splitIdx].role === 'tool') {
    splitIdx++;
  }
  return {
    splitIdx,
    evicted: messages.slice(1, splitIdx),
    kept: messages.slice(splitIdx),
  };
}

export async function compactMessages(messages, {
  window,
  highWatermark = 0.75,
  lowWatermark = 0.5,
  force = false,
  currentTokens,
  summarize,
  log,
}) {
  const cur = currentTokens == null ? estimateMessagesTokens(messages) : currentTokens;
  const high = highWatermark * window;
  const low = lowWatermark * window;

  if (!force && cur <= high) {
    return { compacted: false, tokens: cur, reason: 'under-threshold' };
  }

  const sysMsg = messages[0];
  const { evicted, kept } = planEviction(messages, { low, currentTokens: cur, force });
  if (evicted.length === 0) {
    return { compacted: false, tokens: cur, reason: 'nothing-to-evict' };
  }

  if (log) log('Compacting conversation…');

  const clean = stripImagesForSummary(evicted);
  try {
    const summaryText = await summarize(clean);
    const summaryMsg = {
      role: 'system',
      content: `Summary of earlier conversation (compacted to save context):\n\n${String(summaryText).trim()}`,
    };
    messages.length = 0;
    messages.push(sysMsg, summaryMsg, ...kept);
    return { compacted: true, tokens: estimateMessagesTokens(messages), reason: 'summarized', evicted: evicted.length };
  } catch (err) {
    messages.length = 0;
    messages.push(sysMsg, ...kept);
    return { compacted: true, tokens: estimateMessagesTokens(messages), reason: 'dropped', evicted: evicted.length, error: err && err.message };
  }
}
