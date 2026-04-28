# Smart Handoff

Zero-friction AI session continuity across any tool, any rate limit.

When Claude hits a rate limit, one command switches you to Gemini CLI with full context — goal, files changed, blocker, decisions — in under 30 seconds.

**Zero LLM calls.** Fully deterministic. No API keys. No cost.

---

## Install

```bash
npm install -g @smarthandoff/cli
```

Or use without installing:
```bash
npx @smarthandoff/cli init
```

Claude Code plugin (no npm needed):
```
/plugin install smart-handoff
```

---

## Quick start

```bash
# Initialize in your project (run once)
smarthandoff init

# When you need to switch tools
smarthandoff route --to gemini

# Or let it fire automatically on rate limit
# (set up by `init` via Claude Code hooks)
```

---

## Commands

### `smarthandoff init`
Initialize Smart Handoff in the current project. Creates `.smarthandoff/config.yaml`, registers Claude Code hooks (StopFailure + PreCompact), detects installed tools.

```bash
smarthandoff init
smarthandoff init --target codex      # set default target
smarthandoff init --no-hooks          # skip hook registration
```

### `smarthandoff route` *(primary command)*
One command: snapshot current session → compress → deliver to target tool.

```bash
smarthandoff route --to gemini        # route to Gemini CLI
smarthandoff route --to codex         # route to Codex CLI
smarthandoff route --to cursor        # write Cursor rules file
smarthandoff route --to chatgpt       # two-part clipboard for ChatGPT
smarthandoff route --to claude        # resume in a new Claude session
smarthandoff route --auto             # auto-detect best available tool
smarthandoff route --to gemini --preview   # preview without delivering
smarthandoff route --to gemini --include-diffs  # include full file diffs
```

### `smarthandoff snapshot`
Capture current session state without routing. Useful for saving state before you know where you're going.

```bash
smarthandoff snapshot                 # save rich handoff
smarthandoff snapshot --mode lean     # minimal (for rate limit recovery)
smarthandoff snapshot --note "focus on the auth module"
smarthandoff snapshot --print         # also print summary
```

### `smarthandoff resume`
Generate a briefing from a previously saved handoff.

```bash
smarthandoff resume --to gemini       # resume from latest handoff
smarthandoff resume --id shoff_abc123 --to codex
smarthandoff resume --to claude --print
```

### `smarthandoff analyze`
Inspect what was extracted and how tokens are allocated.

```bash
smarthandoff analyze                  # analyze latest handoff for gemini
smarthandoff analyze --target codex   # show codex token allocation
smarthandoff analyze --verbose        # dump full JSON
```

### `smarthandoff list`
List all saved handoffs.

```bash
smarthandoff list
smarthandoff list --limit 5
```

---

## Adapter reference

| Target | Delivery | Budget | Unique feature |
|--------|----------|--------|----------------|
| `gemini` | stdin pipe | 50K tokens | Writes GEMINI.md, includes CLAUDE.md, search grounding |
| `codex` | stdin pipe | 8K tokens | Patches AGENTS.md, file:line errors, sandbox flag |
| `cursor` | file write | 20K tokens | Writes `.cursor/rules/handoff.mdc`, @file references |
| `claude` | clipboard | 15K tokens | Shortest format, reads auto-memory, mirrors /compact |
| `chatgpt` | 2-part clipboard | 20K tokens | System prompt + first message |
| `generic` | clipboard | 10K tokens | Universal markdown |

---

## How it works

Smart Handoff reads your Claude Code session transcript (JSONL at `~/.claude/projects/*/`) and extracts signal:

- **Goal** — first user message
- **Files changed** — Write/Edit tool calls
- **Blocker** — last user message + error patterns
- **Decisions** — pattern matching ("decided", "rather than", "instead of")
- **Stack** — package.json dependencies

It strips noise (tool_result events, file reads, bash stdout) — reducing 89K tokens to ~8K of pure signal. Then compresses each section to fit within the target tool's token budget, and delivers in the format the target tool expects.

**No LLM calls.** Every step is deterministic TypeScript.

---

## Claude Code plugin

The plugin adds:

1. `/handoff` slash command — generate a briefing from inside Claude Code without running any CLI
2. **StopFailure hook** — auto-fires on rate limit, routes to your default target tool
3. **PreCompact hook** — auto-snapshot when context window fills (runs async, never blocks)

After `smarthandoff init` or `/plugin install smart-handoff`, hitting a rate limit triggers the handoff automatically.

---

## Project storage

```
your-project/
├── .smarthandoff/
│   ├── config.yaml          ← commit this
│   ├── handoffs/            ← commit these (session history)
│   │   └── shoff_*.json
│   ├── cache/               ← gitignored
│   ├── events.jsonl         ← gitignored (analytics)
│   └── latest.md            ← gitignored (most recent briefing)
└── GEMINI.md                ← written by gemini adapter
```

---

## Monorepo

```
packages/core/    → @smarthandoff/core    (library — build on top of this)
apps/cli/         → @smarthandoff/cli     (the CLI)
plugins/claude-code/ → smart-handoff plugin
```

```bash
pnpm install
pnpm build
pnpm test
```

---

## License

MIT
