# Changelog

## 2.1.1 - 2026-10-23

### Fixed
- **Code blocks in answers are never run.** Commands in ```sh blocks were offered for execution
  after every answer, and once shell commands were set to "always allow" they ran without a
  prompt. A usage example like `npm link` in a final summary would install things globally and
  send the model off on another round. Commands now only run through the `run_shell` tool;
  code blocks are just shown.
- The index line at startup said "keyword search" after a restart even when embeddings were
  stored, because it only counted chunks embedded in that run.

### Changed
- Tool results show what they acted on and a one-line outcome (`✔ write_file todo.js · 812
  bytes`, `✔ run_shell $ npm test · ℹ fail 0`), with a yellow mark for non-zero exits. Before,
  file tools showed nothing and command output spilled over several lines.
- Markdown tables render as aligned columns instead of raw pipes.
- Token usage is shown once per turn (`7 requests · 45k in · 5.3k out`) instead of after every
  request.
- Removed the unused `src/markdown.js`.

## 2.1.0 - 2026-10-23

### Security
- **Every side effect now asks first.** `spawn_background_task`, `invoke_subagent`,
  `manage_workspace` (create/remove), and MCP tools used to run without a prompt, which let a
  model start any shell command in the background with no approval. They now go through the
  same approval overlay as writes and shell commands.
- **Shell injection in `manage_workspace` fixed.** Branch and path arguments were pasted into a
  shell string; git is now called with an argument list. The post-write syntax check had the
  same problem with file names and is fixed the same way.
- **Project settings can no longer redirect your key.** `.aplotita.json` / `.ai-cli.json` from a
  cloned repo could set `baseUrl` or `apiKey` and send your key and code to someone else's
  server. Only model and sampling style keys are accepted now; the rest are ignored with a
  warning.
- **Destructive commands are refused in `--headless` mode** instead of running, still ask in
  `/auto`, and are never auto-run from sh blocks in a headless answer. The screen also catches
  `rm --recursive/--force`, `find -delete`, `git push +ref`, `git checkout -- .`,
  `git restore .`, `git branch -D`, and `git stash clear`.
- **Modes are enforced.** Ask mode only gets read-only tools; architect mode can only write
  markdown files. Previously both modes received every tool and relied on the prompt.
- `config.json`, history, and sessions are written with owner-only permissions.
- `web_fetch` also blocks hosts that resolve to private addresses, IPv4-mapped IPv6 and CGNAT
  ranges, caps downloads at 5 MB, and times out after 30 seconds.
- Dependencies updated to clear the advisories in `@modelcontextprotocol/sdk`, `fast-uri`,
  `body-parser`, `@hono/node-server`, and `vitest`.

### Fixed
- **Requests no longer fail on current models.** `temperature: 0.7` and `max_tokens: 128000`
  were sent to every provider by default; current OpenAI and Anthropic models reject a
  non-default temperature, and most providers reject that output cap. Both are now only sent
  when you set them (`/temp`, `/tokens`), OpenAI gets `max_completion_tokens`, and Anthropic
  gets a 32k default cap.
- **`multi_edit_file` no longer loses edits.** Overlapping ranges were applied one after another
  and silently clobbered each other while reporting success. Overlaps are now rejected and all
  ranges are checked before anything is written.
- A file that fails `node --check` after a write is reported as saved with a warning instead of
  as an error, so the model no longer retries a write that already happened.
- `@` mentions no longer eat `@types/node` style package names or email addresses, and unknown
  mentions stay in your message instead of adding "[File not found]" notes.
- Multi-line paste in the TUI kept the text but dropped every line break. Bracketed paste is now
  supported and line breaks are preserved.
- `Ctrl+C` only interrupted while text was streaming; during a tool run it did nothing. It now
  stops the whole turn, including a running command and everything that command started, and
  `Esc` does the same.
- Interrupting or hitting an API error mid-turn used to delete the whole turn from history, so
  the model forgot edits it had already made on disk. Completed tool rounds are now kept.
- `--continue` and `/resume` could not load a session in which the model had called a tool
  without writing any text.
- The file watcher never started (it used `require` inside an ES module), so the index only
  picked up edits made by the agent. It now loads chokidar with `import`.
- Ollama and custom endpoints no longer demand an API key at setup or startup.
- The model list cache was shared across providers, so switching provider could show the
  previous provider's models for up to an hour. It is now kept per base URL.
- `/models` and the setup picker showed only the first 50 models; all are listed now, with
  type-to-filter.
- `AGENTS.md` hid `.ai-cli.json` when both were in the same folder. They are looked up
  separately now.
- `/retry` and error recovery used stale positions after compaction.
- `grep_search` treated "no matches" as a failure and fell through to slower searches that
  ignored the path and scanned `node_modules`.
- `/mode` did not update the TUI status bar, and `/loader` had no effect in the TUI.
- Timed-out shell commands were reported as exit code 0, and `git worktree` failures were
  reported as success.
- A killed background task was shown as "finished".

### Changed
- Prompt caching works across turns: the system prompt is only rebuilt when the mode changes or
  the conversation is reset, and retrieved code is attached to the latest message instead of
  the system prompt.
- History is stored per project folder in `~/.aplotita/history/`, so `--continue` resumes the
  conversation for the folder you are in and two terminals no longer overwrite each other.
- The tool-round limit per request went from 10 to 25 (configurable with `max_agent_loops`), and
  reaching it now prints a message.
- `run_shell` defaults to a 120 second timeout and accepts `timeout_seconds` (up to 600).
- Headless runs exit with `1` when the request fails and `130` when interrupted.
- Default models updated for each provider.
- The indexer respects `.gitignore`, skips secret-looking config files, and does not run in
  your home directory or `/`.
- Leftover names from earlier versions were cleaned up: `.aplotita.md` / `.aplotita.json` are
  the new project file names (the `.ai-cli.*` names still work), and exports default to
  `aplotita-*.md`.
- All rendering now flows through a single UI controller with two backends:
  the Ink TUI for interactive terminals, and the original scrolling output for
  **headless (`--headless`) and piped/non-TTY** runs, which are unchanged.
- **Node.js 22+ is now required** (Ink's minimum). The startup guard and
  `package.json` engines were bumped from 18 to 22.

### Added
- **"Always allow" for approvals.** Press `a` on an approval prompt to stop being asked about
  that kind of action for the session; `/allow` shows what is allowed and `/allow reset` clears
  it. Destructive commands never offer it.
- **Input editing in the TUI:** prompt history on `↑`/`↓`, `Alt+Enter` for a new line,
  `Ctrl+A`/`Ctrl+E`/`Ctrl+U`/`Ctrl+K`/`Ctrl+W`.
- Overwriting an existing file with `write_file` shows a diff in the approval prompt.
- Mentioning a folder with `@` attaches a listing of it.
- `/temp default` and `/tokens default` hand those settings back to the provider.
- **Accent themes.** `/theme` opens a picker with named accent colors — Aplótita
  Teal, Night Blue, Desert Red, Rust Orange, Pear Green — applied live to the
  input border, prompt marker, and spinner.
- **Full-screen TUI.** Interactive sessions now run in a persistent
  [Ink](https://github.com/vadimdemedes/ink) (React) interface: a scrolling
  conversation view, a fixed input box with a live status bar (mode · model ·
  tokens), a streaming assistant region, and inline **approval overlays** that
  show the diff for every file edit and confirm shell commands without leaving
  the app. `Tab` cycles the mode, `Ctrl+C` interrupts a running turn (or exits
  when idle), and `/models` and the `ask_question` tool open list overlays.

## 2.0.0 — 2026-07-22

Major release. The project is renamed to **aplótita** and gains token-aware
context management, richer output, and a modular internals rewrite.

### Renamed
- **vexra → aplótita.** The npm package and CLI command are now `aplotita`
  (the `vexra` command no longer exists). Config moved to `~/.aplotita/` and
  is **auto-migrated** from `~/.vexra/` or `~/.ai-cli/` on first run. Env knobs
  are now `APLOTITA_*`.

### Added
- **Token-budget context management.** Conversations are measured in tokens
  (preferring the model's real usage) and **auto-compacted** when they cross a
  high watermark: the oldest turns are summarized into a system note down to a
  low watermark, never splitting a tool call from its result, and stripping
  images before summarizing. New `/compact` command; `/history` now shows
  context size as a percentage of the model's window.
- **Better retrieval.** A symbol-lookup retriever (from the acorn index) folded
  into hybrid RRF search, and the retrieval query now spans the last few user
  turns so terse follow-ups still find the right code.
- **Slim ASCII wordmark banners** on startup and exit with an animated
  cyan→magenta gradient, plus a branded input prompt.
- **Richer Markdown rendering** in streamed replies: styled headings, bullet and
  numbered lists, blockquotes, horizontal rules, and framed, syntax-highlighted
  code blocks.
- **Clearer approval UI** for agent actions — colored WRITE / EDIT / SHELL cards
  with the target and, for risky shell commands, the reason in red.
- **Multi-line paste** support via bracketed paste.
- **Image context budget** and a warning when images are attached to a
  likely text-only model.

### Changed
- **Per-provider request adaptation.** Anthropic `cache_control` and the
  OpenRouter-only routing field are now sent only to providers that accept them
  (previously applied to everyone, which could 400 on OpenAI-compatible APIs).
  Error/warning strings are provider-neutral.
- **Modular internals.** The ~1.5k-line `repl.js` was split into focused modules
  (`render`, `prompt`, `history`, `setup`, `session`, `commands`, `agent`,
  `tokens`, `compaction`); `repl.js` is now a thin orchestrator.

### Fixed
- Multi-line pastes no longer submit on the first newline.
- Large images no longer bypass the context size limit.
- Stale `ai-cli` identity strings corrected.

### Tests
- 120 tests passing, including a mocked-network integration test that drives the
  full agent loop.
