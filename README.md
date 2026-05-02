# Smart Handoff

Zero-friction AI session continuity across any tool, any rate limit.

When Claude hits a rate limit, one command switches you to Gemini CLI with full context — goal, files changed, blocker, decisions — in under 30 seconds.

**Zero LLM calls by default. Fully deterministic. No API keys. No cost.**  
Optional `--summarize` flag for LLM-enhanced handoffs via your existing Claude login or any provider API key.

---

## Table of Contents

1. [What It Is](#what-it-is)
2. [The Problem](#the-problem)
3. [How It Works](#how-it-works)
4. [Architecture](#architecture)
5. [Data Model](#data-model)
6. [Quick Start](#quick-start)
7. [Commands](#commands)
8. [Summarization Pass](#summarization-pass)
9. [Adapters](#adapters)
10. [Claude Code Hooks](#claude-code-hooks)
11. [Monorepo Structure](#monorepo-structure)
12. [Project Storage](#project-storage)
13. [Development](#development)

---

## What It Is

Smart Handoff is a tool that captures the state of an AI coding session the moment it ends — whether due to a rate limit, context window exhaustion, or intentional switching — and reconstructs that state as a ready-to-use, model-aware briefing for the next tool or session.

It is **not** a session exporter. It is **not** a transcript formatter. It is a **resumable state machine for AI coding sessions**.

| Surface | Package | Description |
|---------|---------|-------------|
| Core library | `@smarthandoff/core` | The extraction + compression engine. Build on top of it. |
| CLI | `@smarthandoff/cli` (binary: `smarthandoff`) | The primary user interface |

---

## The Problem

When an AI coding session ends unexpectedly — rate limit hit, context window full, or deliberate tool switch — developers face a brutal choice: start over, or spend 10–20 minutes re-explaining their codebase, decisions, and current state to the next tool.

Claude Code sessions can accumulate 89,000+ tokens. Summarizing that manually is painful, error-prone, and breaks flow. Existing "export" tools dump raw transcripts that no tool can meaningfully ingest.

Smart Handoff solves this by extracting only the signal that matters — goal, changed files, blocker, decisions, next step — and compressing it into a model-aware briefing tailored to the target tool's token budget and input format.

---

## How It Works

The extraction pipeline runs entirely in TypeScript with no LLM calls:

```
Claude Code JSONL transcript
         │
         ▼
  ┌─────────────┐
  │  stripNoise  │  Remove tool_result, file reads, bash stdout
  └─────────────┘
         │
         ▼
  ┌──────────────────┐
  │  fromClaudeLogs  │  Extract: goal, files changed, blocker, decisions
  └──────────────────┘
         │
         ├──► fromGit      ─── git status + diff stats
         │
         ├──► fromMemory   ─── Claude auto-memory (~/.claude/projects/.../memory/)
         │
         └──► fromManual   ─── User-provided notes
                  │
                  ▼
            ┌─────────┐
            │  merge   │  Combine all partial Handoff objects
            └─────────┘
                  │
                  ▼
         ┌──────────────────┐
         │  budgetAllocator │  Per-tool token budget allocation
         └──────────────────┘
                  │
                  ▼
           ┌──────────┐
           │ compress  │  Truncate/prioritize each section to fit budget
           └──────────┘
                  │
                  ▼
           ┌─────────┐
           │ adapter  │  Render tool-specific output format
           └─────────┘
                  │
                  ▼
           ┌─────────┐
           │ deliver  │  pipe | clipboard | file-write | two-part-clipboard
           └─────────┘
```

### Extraction details

**Goal** — Taken from the first substantive user message in the session. Strips `<ide_opened_file>`, `<system>`, and other noise tags.

**Files changed** — Extracted from `Write`, `Edit`, `MultiEdit`, and `NotebookEdit` tool calls in assistant events in the JSONL. Paths are relativized to project root. Internal `node_modules`, `.git`, `dist`, `.smarthandoff` paths are filtered out. Last-edit-wins — repeated edits to the same file produce a single entry. File summaries are inferred from the first meaningful line of the written content.

**Blocker** — Taken from the last user message in the session. Also scans for error patterns (stack traces, `Error:`, `FAILED`, `cannot find`, etc.) in the final assistant message.

**Decisions** — Pattern-matched against sentences containing phrases like "decided", "rather than", "instead of", "chose", "rejected", "not using". Filtered against a noise list (markdown headers, fragment punctuation, meta-commentary about the handoff tool itself).

**Stack** — Detected from `package.json` dependencies (TypeScript, React, Next.js, Express, Vitest, etc.) plus Node version.

### Compression

Each section gets a token budget proportional to the target tool's total budget. Sections are compressed by truncating at sentence boundaries rather than mid-word. Files are prioritized by importance. Decisions are sorted by confidence score.

### 89K → 8K

A typical Claude Code session of 89,000 tokens reduces to ~8,000 tokens of pure signal. The noise stripping (tool_result events, file read outputs, bash stdout) accounts for most of the reduction.

---

## Architecture

### Monorepo layout

```
smart-handoff/
├── packages/
│   └── core/                    ← @smarthandoff/core
│       └── src/
│           ├── types.ts          ← Handoff schema (single source of truth)
│           ├── schema.ts         ← Zod validation
│           ├── utils.ts          ← Token estimator, helpers
│           ├── index.ts          ← Public API surface
│           ├── builders/
│           │   ├── fromClaudeLogs.ts   ← JSONL transcript parser
│           │   ├── fromGit.ts          ← git status + diff reader
│           │   ├── fromMemory.ts       ← Claude auto-memory reader
│           │   ├── fromManual.ts       ← User notes builder
│           │   └── merge.ts            ← Partial Handoff combiner
│           ├── compress/
│           │   ├── budgetAllocator.ts  ← Per-tool token budgets
│           │   ├── compress.ts         ← Section-level truncation
│           │   ├── compressDiffs.ts    ← Diff-aware compression
│           │   └── stripNoise.ts       ← JSONL event filter
│           ├── adapters/
│           │   ├── gemini.ts           ← 50K budget, clipboard
│           │   ├── codex.ts            ← 8K budget, clipboard
│           │   ├── cursor.ts           ← 12K budget, writes .cursor/rules/handoff.mdc
│           │   ├── claude.ts           ← 15K budget, clipboard
│           │   ├── chatgpt.ts          ← 12K budget, two-part clipboard
│           │   ├── generic.ts          ← 10K budget, clipboard
│           │   └── index.ts            ← toAdapter() dispatcher
│           └── enhance/
│               ├── providers/          ← LLM summarization providers
│               └── summarize.ts        ← orchestrator + graceful fallback
├── apps/
│   └── cli/                     ← @smarthandoff/cli
│       └── src/
│           ├── index.ts          ← Commander entrypoint
│           ├── commands/
│           │   ├── init.ts       ← smarthandoff init
│           │   ├── route.ts      ← smarthandoff route (+ --save-only)
│           │   ├── resume.ts     ← smarthandoff resume
│           │   ├── list.ts       ← smarthandoff list (+ --inspect)
│           │   └── _buildHandoff.ts  ← shared handoff builder
│           ├── deliver/
│           │   └── index.ts      ← pipe | clipboard | file-write router
│           └── detect/
│               └── toolDetector.ts   ← which tools are in PATH
└── plugins/
    └── claude-code/             ← hook scripts for Claude Code
        └── src/
            └── hooks/
                ├── stopFailure.sh   ← auto-fires on rate limit
                └── preCompact.sh    ← auto-fires on context fill
```

### Core public API

```typescript
import {
  fromClaudeLogs,   // builder: JSONL → Partial<Handoff>
  fromGit,          // builder: git → Partial<Handoff>
  fromMemory,       // builder: auto-memory → Partial<Handoff>
  fromManual,       // builder: notes → Partial<Handoff>
  merge,            // combiner: Partial<Handoff>[] → Handoff
  toAdapter,        // renderer: Handoff + target → AdapterOutput
  allocateBudget,   // util: Handoff + target → SectionBudgets
  compress,         // util: Handoff + budgets → Handoff (truncated)
  summarize,        // optional LLM pass: Handoff → Handoff (enhanced)
  validateHandoff,  // validator: unknown → { success, data | error }
  TOOL_BUDGETS,     // constant: Record<TargetTool, number>
} from '@smarthandoff/core';
```

---

## Data Model

The central `Handoff` object is the canonical representation of a session state snapshot:

```typescript
interface Handoff {
  id: string;                    // shoff_<timestamp>_<source>
  projectRoot: string;           // absolute path
  createdAt: string;             // ISO timestamp
  createdBy: string;             // user@hostname
  mode: 'lean' | 'rich' | 'debug';

  goals: HandoffGoal[];          // what was being built
  goalProgression?: string[];    // how the goal evolved across the session
  decisions: HandoffDecision[];  // choices made (do not re-suggest)
  filesChanged: HandoffFileChange[];  // write/edit tool calls
  blockers: HandoffBlocker[];    // why it stopped
  nextSteps: HandoffNextStep[];  // what to do next

  sessionSegments?: HandoffSessionSegment[];  // prior context windows (post-compaction)
  prLinks?: string[];                         // PR URLs found in session

  context: {
    stack: string[];             // detected tech stack
    claudeMdContent?: string;    // raw CLAUDE.md
    packageJson?: { name, version, dependencies };
  };

  sources: HandoffSource[];      // which builders contributed
  extractionConfidence: number;  // 0–1
  rawTokenCount: number;         // before compression
}
```

---

## Quick Start

```bash
# Install globally
npm install -g @smarthandoff/cli

# Initialize in your project (once)
smarthandoff init

# When you need to switch tools:
smarthandoff route --to gemini --launch
```

---

## Commands

### `smarthandoff init`

Initializes Smart Handoff in the current project directory.

**What it does:**
1. Creates `.smarthandoff/handoffs/` directory
2. Detects installed tools (`gemini`, `codex`, `cursor`, `claude`) via PATH
3. Writes `.smarthandoff/config.yaml` with sensible defaults
4. Registers Claude Code hooks in `~/.claude/settings.json`:
   - `StopFailure` → auto-routes to your default target on rate limit
   - `PreCompact` → async snapshot when context fills

**Flags:**
```
--target <tool>   Set default target (gemini|codex|cursor|claude|chatgpt|generic)
--no-hooks        Skip Claude Code hook registration
```

**Examples:**
```bash
smarthandoff init
smarthandoff init --target codex
smarthandoff init --no-hooks
```

---

### `smarthandoff route` *(primary command)*

One command: snapshot current session → compress → deliver to target tool.

**What it does:**
1. Reads the most recent Claude Code JSONL transcript from `~/.claude/projects/*/`
2. Runs collectors (claudeLogs, git, memory)
3. Merges partials into a `Handoff` object
4. Saves it as `.smarthandoff/handoffs/<id>.json` and `.smarthandoff/latest.json`
5. Renders adapter output for the target tool
6. Delivers (clipboard / file-write / two-part-clipboard)

**Flags:**
```
--to <tool>              gemini | codex | cursor | claude | chatgpt | generic
--mode <mode>            lean | rich | debug (default: rich)
--budget <tokens>        Override token budget
--include-diffs          Include full file diffs in output
--preview                Print briefing to stdout without delivering
--launch                 Copy handoff to clipboard and launch the target CLI
--save-only              Capture and save without delivering to any tool
--summary                Print goal + blocker after saving (use with --save-only)
--note <text>            Inject a manual note into the handoff
--session-id <id>        Use a specific Claude session instead of the most recent
--summarize [provider]   LLM enhancement pass: auto | claude-cli | anthropic | gemini | openai
```

**Examples:**
```bash
smarthandoff route --to gemini
smarthandoff route --to codex
smarthandoff route                          # auto-detects best available tool

# One-command handoff: copies briefing to clipboard, spawns target CLI
smarthandoff route --to gemini --launch     # opens gemini --skip-trust
smarthandoff route --to codex --launch      # opens codex
smarthandoff route --to claude --launch     # opens claude

# Preview before delivering
smarthandoff route --to gemini --preview

# Save only (no delivery — useful as a checkpoint)
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
smarthandoff route --to gemini --summarize claude-cli
```

**`--launch` behavior:**

| Target | Binary launched | Extra flags |
|--------|----------------|-------------|
| `gemini` | `gemini` | `--skip-trust` |
| `codex` | `codex` | — |
| `claude` | `claude` | — |
| `cursor`, `chatgpt`, `generic` | — | Falls back to clipboard + manual run message |

When `--launch` is set:
1. Formatted prompt is copied to clipboard
2. Terminal prints `✓ Handoff copied to clipboard`
3. Target CLI is spawned interactively (full TTY — no pipe, no API key)
4. Paste with Cmd+V as your first message

---

### `smarthandoff resume`

Re-deliver a previously saved handoff to any target. Does not re-read the transcript — uses the already-extracted snapshot.

**Flags:**
```
--id <handoffId>     Handoff ID to use (default: most recent)
--to <tool>          Target tool (default: generic)
--budget <tokens>    Override token budget
--copy               Force copy to clipboard
--print              Print to stdout instead of delivering
```

**Examples:**
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

**Flags:**
```
--limit <n>          Number to show (default: 10)
--inspect [id]       Token allocation breakdown (default: most recent)
--target <tool>      Target for --inspect budget calculation (default: gemini)
--json               Dump full handoff JSON (use with --inspect)
```

**Examples:**
```bash
smarthandoff list
smarthandoff list --limit 5
smarthandoff list --inspect
smarthandoff list --inspect shoff_1777385087720_manual
smarthandoff list --inspect --target codex
smarthandoff list --inspect --json
```

---

## Summarization Pass

The `--summarize` flag adds an optional LLM pass after deterministic extraction. It feeds the cleaned session transcript to an LLM and rewrites every text field — goal, decisions, file summaries, blockers, next steps — producing a handoff that reads like a PR description rather than a pattern-match dump.

**Providers:**

| Provider | Env var needed | Default model | Notes |
|----------|---------------|--------------|-------|
| `claude-cli` | — | `sonnet` | Uses the installed `claude` binary — no API key |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` | Anthropic SDK, tool-use structured output |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` | Google AI SDK, JSON mode |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` | OpenAI SDK, JSON schema response format |

```bash
# Auto-detect provider from env vars (falls back to claude-cli)
smarthandoff route --to gemini --summarize

# Explicit provider
smarthandoff route --to gemini --summarize claude-cli
smarthandoff route --to gemini --summarize gemini
smarthandoff route --to gemini --summarize gemini/gemini-2.5-flash
smarthandoff route --to gemini --summarize anthropic
smarthandoff route --to gemini --summarize openai
```

---

## Adapters

| Target | Budget | Output format | Delivery |
|--------|--------|---------------|----------|
| `gemini` | 50,000 | Markdown `## CONTEXT` sections | Clipboard |
| `claude` | 15,000 | `## Session resume` format | Clipboard |
| `codex` | 8,000 | `TASK:`/`FILE:` prefix style | Clipboard |
| `cursor` | 12,000 | MDC rule file | `.cursor/rules/handoff.mdc` |
| `chatgpt` | 12,000 | Two-part system + user message | Clipboard (two pastes) |
| `generic` | 10,000 | Plain markdown | Clipboard |

---

## Claude Code Hooks

`smarthandoff init` registers two hooks in `~/.claude/settings.json`:

**StopFailure** — fires when Claude Code hits a rate limit. Automatically runs:
```bash
smarthandoff route --mode lean
```

**PreCompact** — fires asynchronously when the context window is filling up. Saves a lean checkpoint before compaction:
```bash
smarthandoff route --save-only --mode lean
```

Both hooks require `@smarthandoff/cli` to be installed globally (`npm install -g @smarthandoff/cli`).

---

## Monorepo Structure

```
smart-handoff/
├── packages/core/          @smarthandoff/core — library
├── apps/cli/               @smarthandoff/cli — CLI binary
├── plugins/claude-code/    hook scripts for Claude Code
├── pnpm-workspace.yaml
└── .smarthandoff/          project handoff storage
```

```bash
pnpm install        # install all deps
pnpm build          # build all packages
pnpm --filter @smarthandoff/core test   # run unit tests
```

---

## Project Storage

```
your-project/
├── .smarthandoff/
│   ├── config.yaml          ← project config
│   ├── latest.json          ← most recent handoff (JSON)
│   ├── latest.md            ← most recent handoff (formatted)
│   └── handoffs/
│       └── shoff_*.json     ← all saved handoffs
├── GEMINI.md                ← written by gemini adapter (persistent project context)
└── .cursor/rules/
    └── handoff.mdc          ← written by cursor adapter
```

---

## Development

```bash
pnpm install
pnpm build
pnpm --filter @smarthandoff/core test
```

**Adding a new adapter:**
1. Add target name to `TargetTool` in `packages/core/src/types.ts`
2. Add budget entry to `TOOL_BUDGETS` in `budgetAllocator.ts`
3. Add allocation case to `allocateBudget()`
4. Create `packages/core/src/adapters/<name>.ts`
5. Register it in `packages/core/src/adapters/index.ts`
6. Add a test case to `adapters.test.ts`

---

## License

MIT
