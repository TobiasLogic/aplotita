export const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_dir', 'grep_search', 'git_status', 'git_diff', 'web_fetch', 'ask_question',
]);

export const FILE_WRITE_TOOLS = new Set(['write_file', 'edit_file', 'multi_edit_file']);

const MARKDOWN_RE = /\.(md|mdx|markdown)$/i;

export function isToolAllowedInMode(mode, name) {
  if (mode === 'ask') return READ_ONLY_TOOLS.has(name);
  if (mode === 'architect') return READ_ONLY_TOOLS.has(name) || FILE_WRITE_TOOLS.has(name);
  return true;
}

export function toolsForMode(mode, definitions, isMcp = () => false) {
  return definitions.filter((d) => {
    const name = d?.function?.name;
    return isMcp(name) || isToolAllowedInMode(mode, name);
  });
}

export function modeRestriction(mode, name, args = {}, isMcp = () => false) {
  if (isMcp(name)) return null;
  if (!isToolAllowedInMode(mode, name)) {
    return `${name} is not available in ${mode} mode. Explain what you would do instead, or ask the user to switch to build mode.`;
  }
  if (mode === 'architect' && FILE_WRITE_TOOLS.has(name) && !MARKDOWN_RE.test(String(args.path || ''))) {
    return 'In architect mode you can only write markdown documents (.md). Ask the user to switch to build mode to change code.';
  }
  return null;
}
