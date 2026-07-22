export const CHARS_PER_TOKEN = 4;
export const IMAGE_TOKEN_COST = 1000;
export const PER_MESSAGE_OVERHEAD = 4;

function textTokens(str) {
  if (!str) return 0;
  return Math.ceil(String(str).length / CHARS_PER_TOKEN);
}

export function estimateTokens(content) {
  if (content == null) return 0;
  if (typeof content === 'string') return textTokens(content);
  if (Array.isArray(content)) {
    let total = 0;
    for (const part of content) {
      if (!part) continue;
      if (typeof part === 'string') {
        total += textTokens(part);
      } else if (part.type === 'image_url' || part.type === 'image') {
        total += IMAGE_TOKEN_COST;
      } else if (typeof part.text === 'string') {
        total += textTokens(part.text);
      }
    }
    return total;
  }
  return textTokens(JSON.stringify(content));
}

export function estimateMessageTokens(msg) {
  if (!msg) return 0;
  let total = PER_MESSAGE_OVERHEAD;
  total += estimateTokens(msg.content);
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      total += textTokens(tc?.function?.name || '');
      total += textTokens(tc?.function?.arguments || '');
    }
  }
  return total;
}

export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const m of messages || []) total += estimateMessageTokens(m);
  return total;
}
