# Smart Handoff

**AI session continuity — one command, zero friction.**

When Claude hits a rate limit or context limit, `smarthandoff` extracts what matters from your session — goal, files changed, decisions, blockers — and hands it off to Gemini, Codex, Cursor, or any AI tool, ready to continue immediately.

No API keys required. No transcript dumping. Under 30 seconds.

```bash
smarthandoff route --to gemini --launch
```

---

## Why

AI tools hit limits constantly — rate limits, context windows, model switches. Every time they do, you lose state. Re-explaining 60 files of context and a dozen decisions from scratch kills flow.

Smart Handoff fixes this by reading your Claude Code session JSONL, stripping the noise, and compressing the signal into a model-aware briefing sized for wherever you're going next.

---

## Install

```bash
npm install -g @smarthandoff/cli
```

Two aliases: `smarthandoff` and `shoff`.

---

## Quick start

```bash
# Initialize in your project (once)
shoff init

# When you need to switch tools
shoff route --to gemini --launch
```

`--launch` copies the briefing to your clipboard and opens the target CLI interactively. Paste with Cmd+V and continue.

---

## Commands

### `shoff route` — the primary command

Snapshot your session, compress it, deliver to a target tool.

```bash
shoff route --to gemini              # clipboard delivery
shoff route --to gemini --launch     # clipboard + spawn gemini interactively
shoff route --to codex --launch      # clipboard + spawn codex
shoff route --to claude --launch     # clipboard + spawn claude

shoff route --to gemini --preview    # print briefing without delivering
shoff route --save-only              # save snapshot without delivering
shoff route --save-only --summary    # save + print goal/blocker summary
shoff route --save-only --note "focus on auth module next"
```

**With LLM summarization** — rewrites extracted fields into clean prose:

```bash
shoff route --to gemini --summarize                      # auto-detect provider
shoff route --to gemini --summarize claude-cli           # no API key needed
shoff route --to gemini --summarize gemini               # uses GEMINI_API_KEY
shoff route --to gemini --summarize gemini/gemini-2.5-flash
shoff route --to gemini --summarize openai               # uses OPENAI_API_KEY
shoff route --to gemini --summarize anthropic            # uses ANTHROPIC_API_KEY
```

### `shoff list` — inspect saved handoffs

```bash
shoff list                           # all saved handoffs
shoff list --inspect                 # token allocation breakdown (most recent)
shoff list --inspect --target codex  # view for a different target
shoff list --inspect --json          # raw handoff JSON
```

### `shoff resume` — re-deliver a saved handoff

```bash
shoff resume --to gemini             # re-deliver most recent
shoff resume --id shoff_177... --to codex
shoff resume --to claude --print     # print to stdout
```

### `shoff init` — set up in your project

```bash
shoff init                           # detect tools, write config, register hooks
shoff init --target codex            # set default target
shoff init --no-hooks                # skip Claude Code hook registration
```

---

## How it works

```
Claude Code JSONL transcript
         │
         ▼
    stripNoise         remove tool results, file reads, bash output
         │
         ▼
  fromClaudeLogs       goal · files changed · decisions · blockers · next steps
         │
    fromGit  ──────    git status + diff stats
    fromMemory  ───    Claude auto-memory
         │
         ▼
       merge           combine all partial state
         │
         ▼
  budgetAllocator      per-section token budgets for the target tool
         │
         ▼
      compress         truncate at sentence boundaries to fit budget
         │
         ▼
      adapter          render tool-specific output format
         │
         ▼
      deliver          clipboard · file-write · two-part-clipboard
```

**What gets extracted:**
- **Goal** — from the first substantive user message, system tags stripped
- **Files changed** — from `Write`/`Edit`/`MultiEdit` tool calls; last-edit-wins, no duplicates
- **Decisions** — pattern-matched sentences: "decided", "rather than", "instead of", "chose"
- **Blockers** — last user message + error patterns in final assistant turn
- **Next steps** — pending `todo_reminder` tasks from the session
- **Stack** — detected from `package.json` + Node version

A typical 89,000 token Claude session compresses to ~8,000 tokens of pure signal.

---

## Target tools

| Target | Budget | Format | Delivery |
|--------|--------|--------|----------|
| `gemini` | 50,000 | Markdown `## CONTEXT` sections | Clipboard |
| `claude` | 15,000 | `## Session resume` format | Clipboard |
| `codex` | 8,000 | `TASK:`/`FILE:` prefix style | Clipboard |
| `cursor` | 12,000 | MDC rule file | `.cursor/rules/handoff.mdc` |
| `chatgpt` | 12,000 | Two-part system + user message | Clipboard |
| `generic` | 10,000 | Plain markdown | Clipboard |

---

## Summarization

By default, extraction is fully deterministic — zero LLM calls, no API keys, no cost.

Add `--summarize` to run an optional LLM pass that rewrites extracted fields into cleaner prose. The difference:

| Field | Default | With `--summarize` |
|-------|---------|-------------------|
| Goal | First 80 chars of first message | "Build smart-handoff CLI: JSONL extraction + summarize pass" |
| Decisions | Pattern-matched sentences | Real choices with rationale, including implicit ones |
| File summaries | First non-comment line of written code | "Adds goal extraction from first user message in JSONL transcript" |
| Next steps | Often empty | Specific, ordered, names the file or command |

| Provider | Env var | Default model |
|----------|---------|--------------|
| `claude-cli` | — | `sonnet` — uses your existing Claude login |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |

---

## Claude Code hooks

`shoff init` registers two hooks in `~/.claude/settings.json`:

- **StopFailure** — fires on rate limit, auto-runs `shoff route`
- **PreCompact** — fires before context compression, saves a lean checkpoint

After init, hitting a rate limit automatically generates and delivers a handoff. Zero manual steps.

---

## Storage

Everything is local, inside your project:

```
.smarthandoff/
  config.yaml       ← project config (commit this)
  latest.json       ← most recent handoff JSON
  latest.md         ← most recent handoff formatted
  handoffs/
    shoff_*.json    ← full history
```

---

## Core library

`@smarthandoff/core` is the extraction and compression engine, usable independently:

```typescript
import { fromClaudeLogs, fromGit, merge, toAdapter, summarize } from '@smarthandoff/core';

const session = await fromClaudeLogs('/path/to/transcript.jsonl', { projectRoot: cwd });
const git     = await fromGit(cwd);
const handoff = merge([session, git], { projectRoot: cwd, mode: 'rich' });

// deterministic — no LLM
const output = toAdapter(handoff, 'gemini');

// or with summarization
const enhanced = await summarize(handoff, { provider: 'claude-cli' });
const output   = toAdapter(enhanced, 'gemini');

console.log(output.text);        // ready to paste
console.log(output.tokenCount);  // estimated tokens
```

---

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@smarthandoff/cli`](https://www.npmjs.com/package/@smarthandoff/cli) | 0.2.2 | CLI — `shoff` binary |
| [`@smarthandoff/core`](https://www.npmjs.com/package/@smarthandoff/core) | 0.2.1 | Core library |

---

## License

MIT
