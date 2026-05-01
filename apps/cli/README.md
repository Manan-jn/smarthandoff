# @smarthandoff/cli

CLI for [Smart Handoff](https://github.com/Manan-jn/smarthandoff) — zero-friction AI session continuity.

When Claude hits a rate limit, one command switches you to Gemini CLI (or Codex, Cursor, ChatGPT) with full context — goal, files changed, blocker, decisions — in under 30 seconds.

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

# When you need to switch tools
smarthandoff route --to gemini

# Or just hit your rate limit — it fires automatically via hooks
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
smarthandoff route --to gemini
smarthandoff route --to codex
smarthandoff route --auto          # auto-detect best available tool
smarthandoff route --to gemini --preview
smarthandoff route --to gemini --summarize   # LLM-enhanced handoff
```

### `smarthandoff snapshot`
Capture session state without routing anywhere. Useful as a checkpoint.

```bash
smarthandoff snapshot
smarthandoff snapshot --note "focus on auth module next"
smarthandoff snapshot --print
```

### `smarthandoff resume`
Deliver a previously saved snapshot to any target.

```bash
smarthandoff resume --to gemini
smarthandoff resume --id shoff_1234567890_manual --to cursor
```

### `smarthandoff analyze`
Inspect a handoff — token allocation, confidence scores, extraction sources.

```bash
smarthandoff analyze
smarthandoff analyze --target codex
```

### `smarthandoff list`
List all saved handoffs for the current project.

```bash
smarthandoff list
```

## Summarization

Add `--summarize` to any `route` or `snapshot` command for an LLM pass that rewrites fields as a proper PR description rather than pattern-matched output:

```bash
smarthandoff route --to gemini --summarize

# With a specific provider
ANTHROPIC_API_KEY=... smarthandoff route --to gemini --summarize --summarize-provider anthropic
GEMINI_API_KEY=...    smarthandoff route --to gemini --summarize --summarize-provider gemini
OPENAI_API_KEY=...    smarthandoff route --to gemini --summarize --summarize-provider openai
```

Default provider: `claude-cli` (uses your existing Claude Code login, no API key needed).

## Full docs

See [github.com/Manan-jn/smarthandoff](https://github.com/Manan-jn/smarthandoff) for the complete README, architecture, and Claude Code plugin docs.

## License

MIT
