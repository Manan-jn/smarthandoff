# @smarthandoff/cli

**Zero-friction AI session continuity.** When Claude hits a rate limit or context limit, one command switches you to Gemini, Codex, or another AI tool with your full session context — goal, files changed, decisions, blocker — in under 30 seconds.

```bash
# Claude hit a rate limit? Run this:
smarthandoff route --to gemini --launch
# → copies handoff to clipboard, opens gemini interactively
# → paste with Cmd+V and continue where you left off
```

**No API keys required by default. Zero LLM calls. Fully deterministic.**  
Optional `--summarize` flag for LLM-enhanced output using any provider.

---

## Install

```bash
npm install -g @smarthandoff/cli
```

Creates two aliases: `smarthandoff` and `shoff`.

---

## Quick start

```bash
# 1. Initialize in your project (once per project)
smarthandoff init

# 2. When you need to switch tools:
smarthandoff route --to gemini --launch

# Or let it fire automatically on rate limit (via Claude Code hooks set up by init)
```

---

## Commands

### `smarthandoff init`

Set up Smart Handoff in the current project. Detects installed AI tools, writes `.smarthandoff/config.yaml`, and registers Claude Code hooks that fire automatically when you hit a rate limit.

```
Options:
  --target <tool>   Default target (gemini|codex|cursor|claude|chatgpt|generic)
  --no-hooks        Skip Claude Code hooks registration
```

```bash
smarthandoff init
smarthandoff init --target codex
smarthandoff init --no-hooks
```

---

### `smarthandoff route`

Snapshot the current session and deliver it to a target AI tool. This is the primary command.

**What it does:**
1. Reads your most recent Claude Code transcript
2. Extracts: goal, files changed, decisions, blockers, next steps
3. Merges with git context and Claude memory
4. Compresses to the target tool's token budget
5. Delivers (clipboard, file-write, or pipe depending on target)

```
Options:
  --to <tool>                   Target: gemini | codex | cursor | claude | chatgpt | generic
  --launch                      Copy prompt to clipboard and open the target CLI directly
  --mode <mode>                 lean | rich | debug  (default: rich)
  --budget <tokens>             Override token budget
  --include-diffs               Include full git diffs in file sections
  --preview                     Print the formatted briefing without delivering
  --save-only                   Build and save handoff without delivering
  --summary                     Print goal + blocker summary (use with --save-only)
  --note <text>                 Inject a manual note into the handoff
  --session-id <id>             Use a specific Claude session instead of the most recent
  --summarize [provider/model]  LLM enhancement pass (see Summarization below)
```

**Examples:**

```bash
# Standard delivery — copies formatted prompt to clipboard
smarthandoff route --to gemini
smarthandoff route --to codex
smarthandoff route --to claude
smarthandoff route                          # auto-detect best available tool

# --launch: clipboard + spawn target CLI interactively (no API key needed)
smarthandoff route --to gemini --launch     # opens gemini --skip-trust
smarthandoff route --to codex --launch      # opens codex
smarthandoff route --to claude --launch     # opens claude

# Preview before delivering
smarthandoff route --to gemini --preview

# Save without delivering (useful as a checkpoint)
smarthandoff route --save-only
smarthandoff route --save-only --note "focus on the auth module next"
smarthandoff route --save-only --summary

# Different modes
smarthandoff route --to gemini --mode lean   # minimal output
smarthandoff route --to gemini --mode debug  # 100K budget, no compression

# With LLM summarization
smarthandoff route --to gemini --summarize
smarthandoff route --to gemini --summarize gemini
smarthandoff route --to gemini --summarize gemini/gemini-2.5-flash
smarthandoff route --to gemini --summarize claude-cli  # no API key needed
```

**`--launch` behavior:**

When `--launch` is used:
1. The handoff prompt is copied to your clipboard
2. Terminal prints `✓ Handoff copied to clipboard`
3. The target CLI is spawned interactively (full TTY — no pipe, no API key)
4. You paste with Cmd+V as your first message

| Target | CLI launched | Extra flags |
|--------|-------------|-------------|
| `gemini` | `gemini` | `--skip-trust` |
| `codex` | `codex` | — |
| `claude` | `claude` | — |
| `cursor`, `chatgpt`, `generic` | — | Falls back to clipboard + manual run |

**Expected output:**

```
⠋ Building handoff for gemini…
✔ Session parsed · 2 goals, 8 files
  Goal: Implement JWT refresh endpoint
  Blocker: Tests failing on tokenRefresh.test.ts
  Compressed: 4,821 tokens (budget: 50,000)

Delivering to gemini...
✓ Briefing copied to clipboard (4,821 tokens)

  Run: gemini --skip-trust  — then paste with Cmd+V / Ctrl+V
```

---

### `smarthandoff resume`

Re-deliver a previously saved handoff to any target. Does not re-read the transcript — uses the already-extracted snapshot.

```
Options:
  --id <handoffId>   Handoff ID to use (default: most recent)
  --to <tool>        Target tool (default: generic)
  --budget <tokens>  Override token budget
  --copy             Force copy to clipboard
  --print            Print to stdout instead of delivering
```

```bash
smarthandoff resume --to gemini
smarthandoff resume --to codex
smarthandoff resume --id shoff_1777385087720_manual --to cursor
smarthandoff resume --to claude --print
smarthandoff resume --to gemini --budget 20000
```

---

### `smarthandoff list`

List all saved handoffs, or inspect one in detail.

```
Options:
  --limit <n>        Number to show (default: 10)
  --inspect [id]     Show token allocation breakdown (default: most recent)
  --target <tool>    Target for --inspect budget calculation (default: gemini)
  --json             Dump full handoff JSON (use with --inspect)
```

```bash
smarthandoff list
smarthandoff list --limit 5
smarthandoff list --inspect                          # most recent
smarthandoff list --inspect shoff_1777385087720_manual
smarthandoff list --inspect --target codex           # codex budget view
smarthandoff list --inspect --json                   # raw JSON
```

**Example output:**

```
SMART HANDOFFS — /Users/you/my-project

  shoff_1777385087720_manual  2 hours ago   Implement JWT refresh endpoint
  shoff_1777385162745_manual  1 hour ago    Fix budget allocator scaling
  shoff_1777385231291_manual  30 mins ago   Add decision noise filters

Total: 3 handoffs
Run: smarthandoff resume --id <id> --to <tool>
```

```
HANDOFF shoff_1777385087720_manual
Created: 2026-04-29T12:34:56Z · Source: claude-code

TOKEN ALLOCATION (target: gemini, budget: 50,000)
  Goal         ████░░░░░░░░░░░░░░░░ ~4,000 tokens  (1 goals)
  Decisions    ██░░░░░░░░░░░░░░░░░░ ~2,500 tokens  (3 decisions)
  Files        ███████░░░░░░░░░░░░░ ~7,000 tokens  (8 files)
  ...

CONFIDENCE SCORES
  Overall:  82%
```

---

## Summarization

Add `--summarize` to any `route` command for an LLM pass that rewrites extracted fields into cleaner prose:

```bash
# Auto-detect provider (tries claude-cli first, then env vars)
smarthandoff route --to gemini --summarize

# Explicit provider — requires the matching env var
GEMINI_API_KEY=...    smarthandoff route --to gemini --summarize gemini
OPENAI_API_KEY=...    smarthandoff route --to gemini --summarize openai
ANTHROPIC_API_KEY=... smarthandoff route --to gemini --summarize anthropic

# Uses your existing Claude Code login — no API key needed
smarthandoff route --to gemini --summarize claude-cli

# Specific model
smarthandoff route --to gemini --summarize gemini/gemini-2.5-flash
```

---

## Target tools and token budgets

| Target | Budget | Format | Delivery |
|--------|--------|--------|----------|
| `gemini` | 50,000 | Markdown sections | Clipboard + GEMINI.md |
| `claude` | 15,000 | Session resume format | Clipboard |
| `codex` | 8,000 | TASK:/FILE: prefix style | Clipboard + AGENTS.md |
| `cursor` | 12,000 | MDC rule file | `.cursor/rules/handoff.mdc` |
| `chatgpt` | 12,000 | Two-part system+message | Clipboard (two pastes) |
| `generic` | 10,000 | Plain markdown | Clipboard |

---

## Claude Code hooks

`smarthandoff init` registers two hooks automatically:

- **StopFailure** — fires when Claude hits a rate limit, auto-routes your session
- **PreCompact** — saves a lean checkpoint before context compression

Both run `smarthandoff` via shell and require the CLI to be installed globally.

---

## Storage

Everything is stored locally in `.smarthandoff/` inside your project:

```
.smarthandoff/
  config.yaml          ← project config (target, collectors)
  latest.json          ← most recent handoff (JSON)
  latest.md            ← most recent handoff (formatted for target)
  handoffs/
    shoff_<id>.json    ← all saved handoffs
```

---

## Full documentation

See [github.com/Manan-jn/smarthandoff](https://github.com/Manan-jn/smarthandoff) for full docs, architecture, and the `@smarthandoff/core` library API.

## License

MIT
