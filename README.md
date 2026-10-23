# aplótita

**The simple terminal AI coding assistant**

![aplotita](https://img.shields.io/badge/apl%C3%B3tita-simplicity-36D0D0?style=for-the-badge)
![Node](https://img.shields.io/badge/node-%3E%3D22-48E080?style=for-the-badge&logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/platform-macOS_·_Linux_·_Windows-5555FF?style=for-the-badge)

aplótita is a terminal-native AI coding assistant that lives inside your workflow. It maps your
codebase, runs tools, edits files, executes commands, and can drive long autonomous tasks, all
from a fast, full-screen TUI: a scrolling conversation view, a persistent input box and status
bar, streaming markdown, and inline approval overlays for every file edit and command. Bring your
own model from OpenRouter, OpenAI, Anthropic, Gemini, Groq, DeepSeek, xAI, a local Ollama, or any
OpenAI-compatible server.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Keyboard](#keyboard)
- [Slash Commands](#slash-commands)
- [Attaching Context with `@`](#attaching-context-with-)
- [Supported Providers](#supported-providers)
- [Configuration](#configuration)
- [Safety](#safety)
- [Updating & Uninstalling](#updating--uninstalling)
- [License](#license)

---

## Features

- **Semantic code index:** builds a hybrid retrieval index of your repo (vector embeddings via
  `sqlite-vec`, BM25 keyword search via FTS5, and exact-identifier search, fused with reciprocal
  rank fusion) and adds the most relevant snippets to each request so the model locates code
  precisely instead of blindly listing directories. Symbols are extracted with `acorn` (JS/TS).
  It follows your `.gitignore`, re-indexes as files change, and degrades gracefully: with no
  embeddings endpoint (or on older Node) it falls back to keyword search.
- **Dynamic modes:** press `Tab` while typing to cycle agent personalities. Each mode only gets
  the tools it is allowed to use, so the limits are enforced, not just suggested.
  - `[BUILD]`: full access to write code and run commands (default).
  - `[ARCHITECT]`: reads and searches the project and can write markdown documents only.
  - `[ASK]`: mentor mode; read-only tools, never edits files or runs commands.
- **Autonomous task loop:** `/auto <prompt>` kicks off a self-correcting, multi-step run that
  keeps going until the goal is met. Tool use is approved automatically, destructive commands
  still ask, and `Esc` stops it.
- **Headless and CI-ready:** `--headless` runs non-interactively, auto-approves routine tool use,
  refuses destructive commands, and exits non-zero if the request fails. Drop it into pipelines
  or spawn it as a subagent.
- **Rich tool suite:** read/write/edit/multi-edit files, list dirs, grep, run shell, git
  status/diff, fetch web pages, manage background tasks, spin up git worktrees, and ask you
  multiple-choice questions mid-task.
- **`@`-mention context:** pull file contents, globs, directory listings, and images straight
  into your prompt (`@src/api.js`, `@src/*.js`, `@src`, `@screenshot.png`).
- **Multimodal:** attach images via `@` to vision-capable models.
- **Sessions and history:** history is auto-saved per project folder, summarized on the fly when
  the context fills up, and you can save, load, and delete named sessions.
- **Prompt caching:** applies cache breakpoints for OpenRouter models and keeps the system prompt
  stable between turns, so long chats actually hit the cache.
- **Built-in guardrails:** every file write, shell command, background task, subagent, worktree
  change, and MCP tool call asks first. Destructive commands (`rm -rf`, `git push --force`,
  `git checkout -- .`, fork bombs, disk writes, and more) always get a red warning.
- **Model Context Protocol (MCP):** connect external data sources and tools natively.
- **Spinner styles:** pick your loader with `/loader`. Output degrades to plain text when piped
  or non-TTY.

---

## Requirements

- **Node.js 22 or newer.** The full-screen TUI is built on [Ink](https://github.com/vadimdemedes/ink)
  (React), which requires Node 22+. Semantic code indexing uses the built-in `node:sqlite`
  (Node 22.5+); on 22.0–22.4 the indexer self-disables and the rest of aplótita works normally.
- An API key from a [supported provider](#supported-providers), or a local
  [Ollama](https://ollama.com) or other OpenAI-compatible server (llama.cpp, vLLM, LM Studio),
  which need no key.

---

## Installation

> **Canonical source is GitHub.** All commands below install the exact code in this repo. The
> package name is `aplotita`, so it runs as `aplotita` and uninstalls by name no matter how you
> installed it.

### Try it instantly, no install

Run the latest straight from GitHub without adding anything global:

```bash
# npm
npx github:TobiasLogic/aplotita

# pnpm
pnpm dlx github:TobiasLogic/aplotita
```

### Global install

Pick your package manager:

```bash
# npm
npm install -g github:TobiasLogic/aplotita

# pnpm
pnpm add -g github:TobiasLogic/aplotita

# yarn
yarn global add github:TobiasLogic/aplotita

# bun
bun add -g github:TobiasLogic/aplotita
```

Then run `aplotita` from anywhere.

> If `aplotita` isn't found after install, make sure your package manager's global bin is on your
> `PATH` (`npm bin -g`, `pnpm bin -g`, `~/.yarn/bin`, or `~/.bun/bin`).

### From source

```bash
git clone https://github.com/TobiasLogic/aplotita.git
cd aplotita
npm install
npm install -g .        # installs the `aplotita` command globally
```

Prefer not to install globally? Run it in place:

```bash
node cli.js             # from inside the cloned repo
```

### For contributors (live-linked)

```bash
git clone https://github.com/TobiasLogic/aplotita.git
cd aplotita
npm install
npm link                # symlinks `aplotita` to your working tree
npm test                # run the test suite (vitest)
```

---

## Quick Start

```bash
aplotita
```

On first launch aplótita walks you through picking a provider, pasting an API key, and choosing a
model, then drops you into the chat. Type a request, hit Enter, and approve any file edits or
commands the agent proposes.

```text
◆ [BUILD] Ask something (Tab to switch mode), or /help ...
│  add a --json flag to the export command
```

---

## Usage

```text
aplotita [prompt] [options]

Arguments:
  prompt                  Optional initial prompt (used for headless / one-shot runs)

Options:
  -m, --model <name>      Model ID to use for this run
  -t, --temperature <n>   Sampling temperature (0-2)
      --max-tokens <n>    Max output tokens
  -c, --continue          Resume the previous saved session
      --headless          Run non-interactively and auto-approve tool use
  -h, --help              Show help
```

### Headless automation

Pass a prompt plus `--headless` to run autonomously, which is ideal for CI or scripting:

```bash
aplotita "Fix the failing tests in test/api.test.js" --headless
aplotita -m anthropic/claude-sonnet-4 "Summarize TODOs across the repo" --headless
```

In headless mode the exit code is `0` on success, `1` if the request failed, and `130` if it
was interrupted.

### Resume where you left off

```bash
aplotita --continue
```

History is kept per project folder, so `--continue` picks up the last conversation you had in the
current directory.

---

## Keyboard

| Key | Action |
| --- | --- |
| `Enter` | Send |
| `Alt+Enter` | New line (pasted text keeps its line breaks) |
| `↑` / `↓` | Previous / next prompt from this session |
| `Ctrl+A` / `Ctrl+E` | Start / end of line |
| `Ctrl+U` / `Ctrl+K` | Delete to start / end of line |
| `Ctrl+W` | Delete the previous word |
| `Tab` | Cycle mode |
| `Esc` or `Ctrl+C` | Interrupt the running turn, including a running command |
| `Ctrl+C` (idle) | Quit |

On an approval prompt, `y` approves, `n` declines, and `a` approves and stops asking about that
kind of action for the rest of the session (never offered for destructive commands).

---

## Slash Commands

Inside the TUI:

| Command | Description |
| --- | --- |
| `/help` | Show all commands |
| `/sh <cmd>` | Run a shell command directly |
| `/provider` | Set up provider, API key, and model |
| `/model [id]` | Show or switch the model |
| `/models` | Browse and pick models interactively |
| `/temp [n\|default]` | Show or set temperature (0-2); unset by default |
| `/tokens [n\|default]` | Show or set max output tokens; unset by default |
| `/mode [type]` | Switch role: `build`, `architect`, `ask` |
| `/theme` | Pick an accent color |
| `/auto <prompt>` | Run an autonomous agent loop |
| `/loader [style]` | Show or set the spinner style |
| `/save [file]` | Export the conversation to markdown |
| `/retry` | Regenerate the last response |
| `/allow [reset]` | Show or clear "always allow" approvals for this session |
| `/compact` | Summarize older history to free up context |
| `/reset` | Clear the conversation and start fresh |
| `/resume` | Reload the previous saved session for this folder |
| `/session <cmd>` | Named sessions: `list`, `save <name>`, `load <name>`, `delete <name>` |
| `/editor` | Open `$EDITOR` for multi-line input |
| `/history` | Show conversation stats & token usage |
| `/clear` | Clear the screen |
| `/animations` | Preview all animation styles (classic output mode) |
| `/shimmer` | Preview the wave-bar animation (classic output mode) |
| `/exit` | Quit (or press Ctrl+C) |

---

## Attaching Context with `@`

Reference files, globs, or images right in your prompt and aplótita inlines them automatically:

```text
explain the retry logic in @src/api.js
why do these differ? @src/config.js @test/config.test.js
match this design @mockup.png
refactor everything under @src/*.js
```

Images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`) are sent as vision input to capable models.
Mentioning a folder attaches a listing of it. Large files are truncated and a total context cap
keeps requests lean. A mention only counts when it starts a word and points at something that
exists, so npm scopes like `@types/node` and email addresses are sent exactly as you typed them.

---

## Supported Providers

Configure any of these with `/provider` (or `--model` / config file). The default model is shown
for reference.

| Provider | Default model | Get a key |
| --- | --- | --- |
| **OpenRouter** | `anthropic/claude-opus-5.5` | https://openrouter.ai/keys |
| **OpenAI** | `gpt-6.1-sol` | https://platform.openai.com/api-keys |
| **Anthropic** | `claude-opus-5-5` | https://console.anthropic.com/settings/keys |
| **Google (Gemini)** | `gemini-3.8-flash` | https://aistudio.google.com/apikey |
| **Groq** | `llama-3.3-70b-versatile` | https://console.groq.com/keys |
| **DeepSeek** | `deepseek-chat` | https://platform.deepseek.com/api_keys |
| **xAI (Grok)** | `grok-4.7` | https://console.x.ai |
| **Ollama (local)** | `qwen3` | No key needed; runs at `http://127.0.0.1:11434` |
| **Custom** | _your choice_ | Any OpenAI-compatible endpoint; the key is optional |

The setup picks from the provider's live model list when it has one, and lets you type to narrow
long lists. Temperature and max output tokens are left to the provider unless you set them, since
many current models reject non-default sampling settings.

---

## Configuration

aplótita stores its config and history under `~/.aplotita/` (an existing `~/.vexra/` or `~/.ai-cli/`
from older versions is migrated automatically on first run):

| Path | Purpose |
| --- | --- |
| `~/.aplotita/config.json` | Saved provider, API key, model, and defaults |
| `~/.aplotita/history/` | Auto-saved conversation history (one file per project folder) |
| `~/.aplotita/sessions/` | Named sessions from `/session save` |
| `~/.aplotita/index/` | Semantic code index (one SQLite database per project) |
| `~/.aplotita/models.json` | Model list cache (per provider URL, refreshed hourly) |

The config, history, and session files hold your key and conversations, so they are written
readable by your user only.

Other optional keys in `config.json`: `temperature`, `maxTokens`, `max_agent_loops` (tool rounds
per request, default 25), `context_window`, `compact_high_watermark`, `compact_low_watermark`,
and `mcpServers`.

### Semantic code index

On startup aplótita indexes your project for semantic retrieval and keeps it fresh as you edit. It
chunks your files, embeds them through an OpenAI-compatible `/embeddings` endpoint, and stores the
vectors (`sqlite-vec`) next to a BM25 (FTS5) and exact-identifier index; each turn the most
relevant snippets are folded into the model's context.

Tune it with an optional `indexer` block in `~/.aplotita/config.json` (every field has a default):

```json
{
  "indexer": {
    "enabled": true,
    "embed_provider": "openrouter",
    "embed_model": "openai/text-embedding-3-small",
    "embed_dim": 768,
    "chunk_size": 40,
    "max_files": 2000,
    "ignored": ["node_modules", ".git", "dist", "build"],
    "extensions": ["js", "ts", "py", "go", "rs"]
  }
}
```

- **Embeddings** reuse your active provider's key and base URL by default (OpenRouter / OpenAI);
  set `"embed_provider": "ollama"` for a local server, or `embed_base_url` for a custom endpoint.
- **What gets indexed:** inside a git repo, only files git would track (your `.gitignore` is
  respected). Dotfiles, lockfiles, and config files named like secrets (`secrets.json`,
  `credentials.yaml`, ...) are skipped. Indexing is off when you start aplótita in your home
  directory or `/`.
- **No key, no problem:** without embeddings the index falls back to BM25 + exact-identifier search.
- **Disable** it entirely with `"enabled": false`.

### Per-project settings

Drop these in your project (aplótita searches upward from your working directory, and looks for
each kind separately so you can use both):

- **`AGENTS.md`** or **`.aplotita.md`**: freeform instructions added to the system prompt
  (project conventions, do's and don'ts, architecture notes).
- **`.aplotita.json`**: JSON overrides for `model`, `temperature`, `maxTokens`,
  `context_window`, `max_agent_loops`, and the compaction watermarks. Anything else (such as
  `baseUrl` or `apiKey`) is ignored with a warning, so a cloned repo can never redirect your key.

The older `.ai-cli.md` and `.ai-cli.json` names still work.

### Environment variables

These override the config file for the current shell:

| Variable | Description |
| --- | --- |
| `OPENROUTER_API_KEY` | API key (used for whichever provider is active) |
| `OPENROUTER_BASE_URL` | API base URL |
| `OPENROUTER_MODEL` | Model ID |
| `OPENROUTER_TEMPERATURE` | Temperature (0-2) |
| `OPENROUTER_MAX_TOKENS` | Max output tokens |
| `APLOTITA_MAX_AGENT_LOOPS` | Tool rounds per request before it pauses |
| `APLOTITA_CONTEXT_WINDOW` | Context window to assume when the model's is unknown |
| `APLOTITA_COMPACT_HIGH` / `APLOTITA_COMPACT_LOW` | Compaction watermarks (fractions of the window) |

When running **from source**, a `.env` file in the repo root is loaded automatically.

---

## Safety

aplótita asks before anything with side effects: file writes and edits (with a diff), shell
commands, background tasks, subagents, git worktree changes, and MCP tool calls. Reading and
searching the project never asks. Press `a` on a prompt to stop being asked about that kind of
action for the rest of the session, and `/allow reset` to undo that.

A built-in screen flags destructive operations: recursive or forced deletes (including
`find -delete`), `git push --force` or `+refspec`, `reset --hard`, `clean -f`,
`checkout -- .` / `restore .`, `branch -D`, `stash clear`, piping remote scripts into a shell, raw
disk writes, `mkfs`, fork bombs, and power-state changes. These always show a red confirmation,
even in `/auto` mode, and are refused outright in `--headless` mode. The screen is a safety net,
not a sandbox: other tool use is auto-approved in `--headless` and `/auto`, so point those at
trusted tasks.

Commands run in their own process group, so an interrupt or timeout stops everything a command
started, and background tasks are stopped when you quit.

---

## Updating & Uninstalling

**Update** (GitHub install): re-run your install command, for example:

```bash
npm install -g github:TobiasLogic/aplotita
```

**Update** (from source):

```bash
git pull && npm install -g .
```

**Uninstall** by package name, regardless of how you installed:

```bash
npm uninstall -g aplotita
# or: pnpm rm -g aplotita
# or: yarn global remove aplotita
# or: bun remove -g aplotita
```

---

## License

No license is currently specified for this project. Please contact the author before
redistributing or using it beyond evaluation.

---

*Built for terminal power users.*
