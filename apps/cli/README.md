# @smarthandoff/cli

CLI for [Smart Handoff](https://github.com/Manan-jn/smarthandoff) — zero-friction AI session continuity.

When Claude hits a rate limit, one command switches you to Gemini CLI (or Codex, Claude) with full context — goal, files changed, blocker, decisions — in under 30 seconds.

**Zero LLM calls by default. Fully deterministic. No API keys required.**

## Install

```bash
npm install -g @smarthandoff/cli
# or
npx @smarthandoff/cli init
```

Installs two binaries: `smarthandoff` and `shoff`.

## Quick start

```bash
# Initialize in your project (run once)
smarthandoff init

# When you need to switch tools — copies prompt to clipboard, launches gemini
smarthandoff route --to gemini --launch

# Or just hit your rate limit — fires automatically via hooks
```

## Commands

### `smarthandoff init`
Set up Smart Handoff in the current project. Detects installed tools, writes config, registers Claude Code hooks.

```bash
smarthandoff init
smarthandoff init --target codex
smarthandoff init --no-hooks
```

### `smarthandoff route`
Snapshot → compress → deliver to target tool in one command.

```bash
# Standard delivery (copies formatted prompt to clipboard)
smarthandoff route --to gemini
smarthandoff route --to codex
smarthandoff route                              # auto-detect best available tool

# --launch: copies to clipboard AND spawns the target CLI in your terminal
smarthandoff route --to gemini --launch         # clipboard + spawns gemini --skip-trust
smarthandoff route --to codex --launch          # clipboard + spawns codex
smarthandoff route --to claude --launch         # clipboard + spawns claude

# Preview without delivering
smarthandoff route --to gemini --preview

# Save only (no delivery — replaces the old 'snapshot' command)
smarthandoff route --save-only
smarthandoff route --save-only --note "focus on auth module next"
smarthandoff route --save-only --summary

# With LLM summarization pass
smarthandoff route --to gemini --summarize              # auto-detect provider
smarthandoff route --to gemini --summarize gemini       # explicit provider
smarthandoff route --to gemini --summarize gemini/gemini-2.5-flash
smarthandoff route --to gemini --summarize claude-cli   # no API key needed
```

**`--launch` behavior:**
1. Formats the handoff for the target tool
2. Copies the prompt to your clipboard
3. Prints `✓ Handoff copied to clipboard — Paste it as your first message`
4. Spawns the target CLI interactively in your terminal (full TTY)

Supported `--launch` targets: `gemini`, `codex`, `claude`. Other targets fall back to printing a manual run command.

### `smarthandoff resume`
Deliver a previously saved handoff to any target. Does not re-read the transcript.

```bash
smarthandoff resume --to gemini
smarthandoff resume --to codex
smarthandoff resume --id shoff_1234567890_manual --to cursor
smarthandoff resume --to claude --print         # print to stdout
smarthandoff resume --to generic --budget 500   # custom token budget
```

### `smarthandoff list`
List all saved handoffs, or inspect a specific handoff's token allocation.

```bash
smarthandoff list
smarthandoff list --limit 3
smarthandoff list --inspect                     # most recent
smarthandoff list --inspect --target codex      # allocation for codex budget
smarthandoff list --inspect --json              # dump full handoff JSON
```

## Summarization

Add `--summarize` to any `route` command for an optional LLM pass that rewrites fields using a language model:

```bash
smarthandoff route --to gemini --summarize

# Explicit provider (all require their respective API key env var)
smarthandoff route --to gemini --summarize anthropic    # ANTHROPIC_API_KEY
smarthandoff route --to gemini --summarize gemini       # GEMINI_API_KEY
smarthandoff route --to gemini --summarize openai       # OPENAI_API_KEY
smarthandoff route --to gemini --summarize claude-cli   # no key — uses installed claude
```

## Full docs

See [github.com/Manan-jn/smarthandoff](https://github.com/Manan-jn/smarthandoff) for the complete README, architecture, and Claude Code plugin docs.

## License

MIT
