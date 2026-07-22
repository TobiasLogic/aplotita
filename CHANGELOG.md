# Changelog

## Unreleased

### Added
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

### Changed
- All rendering now flows through a single UI controller with two backends:
  the Ink TUI for interactive terminals, and the original scrolling output for
  **headless (`--headless`) and piped/non-TTY** runs, which are unchanged.
- **Node.js 22+ is now required** (Ink's minimum). The startup guard and
  `package.json` engines were bumped from 18 to 22.

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
