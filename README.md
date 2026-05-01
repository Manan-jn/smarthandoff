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
10. [Claude Code Plugin](#claude-code-plugin)
11. [Monorepo Structure](#monorepo-structure)
12. [Project Storage](#project-storage)
13. [Implementation Plan & Status](#implementation-plan--status)
14. [Development](#development)

---

## What It Is

Smart Handoff is a tool that captures the state of an AI coding session the moment it ends — whether due to a rate limit, context window exhaustion, or intentional switching — and reconstructs that state as a ready-to-use, model-aware briefing for the next tool or session.

It is **not** a session exporter. It is **not** a transcript formatter. It is a **resumable state machine for AI coding sessions**.

The product has three surfaces:

| Surface | Package | Description |
|---------|---------|-------------|
| Core library | `@smarthandoff/core` | The extraction + compression engine. Build on top of it. |
| CLI | `@smarthandoff/cli` (binary: `smarthandoff`) | The primary user interface |
| Claude Code plugin | `smart-handoff` | In-editor UX via `/handoff` skill + auto hooks |

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

**Files changed** — Extracted from `Write`, `Edit`, `MultiEdit`, and `NotebookEdit` tool calls in assistant events in the JSONL. Paths are relativized to project root. Internal `node_modules`, `.git`, `dist`, `.smarthandoff` paths are filtered out. File summaries are inferred from the first meaningful line of the written content.

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
│           │   ├── gemini.ts           ← 50K budget, pipe, writes GEMINI.md
│           │   ├── codex.ts            ← 8K budget, pipe, patches AGENTS.md
│           │   ├── cursor.ts           ← 20K budget, writes .cursor/rules/handoff.mdc
│           │   ├── claude.ts           ← 15K budget, clipboard
│           │   ├── chatgpt.ts          ← 20K budget, two-part clipboard
│           │   ├── generic.ts          ← 10K budget, clipboard
│           │   └── index.ts            ← toAdapter() dispatcher
│           └── policy/
│               └── evaluator.ts        ← Should-handoff policy checks
├── apps/
│   └── cli/                     ← @smarthandoff/cli
│       └── src/
│           ├── index.ts          ← Commander entrypoint
│           ├── config.ts         ← YAML config loader/writer
│           ├── analytics.ts      ← events.jsonl emitter
│           ├── commands/
│           │   ├── init.ts       ← smarthandoff init
│           │   ├── route.ts      ← smarthandoff route
│           │   ├── snapshot.ts   ← smarthandoff snapshot
│           │   ├── resume.ts     ← smarthandoff resume
│           │   ├── analyze.ts    ← smarthandoff analyze
│           │   ├── list.ts       ← smarthandoff list
│           │   └── _buildHandoff.ts  ← shared handoff builder
│           ├── deliver/
│           │   └── index.ts      ← pipe | clipboard | file-write router
│           └── detect/
│               └── toolDetector.ts   ← which tools are in PATH
└── plugins/
    └── claude-code/             ← smart-handoff Claude Code plugin
        └── src/
            ├── manifest.json
            ├── skills/
            │   └── handoff.md   ← /handoff skill definition
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
  decisions: HandoffDecision[];  // choices made (do not re-suggest)
  filesChanged: HandoffFileChange[];  // write/edit tool calls
  blockers: HandoffBlocker[];    // why it stopped
  nextSteps: HandoffNextStep[];  // what to do next

  context: {
    stack: string[];             // detected tech stack
    testCommand?: string;
    buildCommand?: string;
    claudeMdContent?: string;    // raw CLAUDE.md
    agentsMdContent?: string;    // raw AGENTS.md
    packageJson?: { name, version, dependencies };
  };

  sources: HandoffSource[];      // which builders contributed
  extractionConfidence: number;  // 0–1
  rawTokenCount: number;         // before compression
  cachedOutputs?: Partial<Record<TargetTool, AdapterOutput>>;
}
```

---

## Quick Start

```bash
# Install globally
npm install -g @smarthandoff/cli

# Or run without installing
npx @smarthandoff/cli init

# Claude Code plugin (no npm needed)
# In Claude Code: /plugin install smart-handoff
```

```bash
# Step 1: initialize in your project (run once)
smarthandoff init

# Step 2: when you need to switch tools
smarthandoff route --to gemini

# Or just hit your rate limit — it auto-fires via hooks
```

---

## Commands

### `smarthandoff init`

Initializes Smart Handoff in the current project directory.

**What it does:**
1. Creates `.smarthandoff/handoffs/` and `.smarthandoff/cache/` directories
2. Detects installed tools (`gemini`, `codex`, `cursor`, `claude`) via PATH
3. Writes `.smarthandoff/config.yaml` with sensible defaults
4. Registers Claude Code hooks in `~/.claude/settings.json`:
   - `StopFailure[rate_limit]` → auto-routes to your default target
   - `PreCompact[auto]` → async snapshot when context fills
5. Appends `.smarthandoff/cache/`, `events.jsonl`, `latest.md` to `.gitignore`

**Flags:**
```
--target <tool>   Set default target (gemini|codex|cursor|claude|chatgpt|generic)
--no-hooks        Skip Claude Code hook registration
```

**Example:**
```bash
smarthandoff init
smarthandoff init --target codex
smarthandoff init --no-hooks
```

**Expected output:**
```
Initializing Smart Handoff...

Detected tools:
  ✓ gemini
  ✗ codex
  ✗ cursor
  ✓ claude

✓ Created .smarthandoff/config.yaml
✓ Registered Claude Code hooks:
    PreCompact → auto-snapshot when context fills
    StopFailure[rate_limit] → auto-route when rate limited

✅ Smart Handoff initialized!
   Run: smarthandoff route --to <tool>  when you need to switch
   Or just hit your rate limit — it auto-fires 🚀
```

---

### `smarthandoff route` *(primary command)*

One command: snapshot current session → compress → deliver to target tool.

**What it does:**
1. Reads the most recent Claude Code JSONL transcript from `~/.claude/projects/*/`
2. Runs all enabled collectors (claudeLogs, git, memory)
3. Merges partials into a `Handoff` object
4. Saves it as `.smarthandoff/handoffs/<id>.json` and `.smarthandoff/latest.json`
5. Renders adapter output for the target tool
6. Delivers (pipe / clipboard / file-write)
7. Emits an analytics event to `.smarthandoff/events.jsonl`

**Flags:**
```
--to <tool>          Target: gemini | codex | cursor | claude | chatgpt | generic
--auto               Auto-detect best available installed tool
--mode <mode>        lean | rich (default: rich)
--budget <tokens>    Override token budget
--include-diffs      Include full file diffs in output
--preview            Print briefing to stdout without delivering
--trigger <trigger>       manual | rate_limit | precompact (for analytics, default: manual)
--session-id <id>         Use a specific Claude session instead of the most recent
--summarize               LLM summarization pass for higher-quality handoff (see Summarization Pass)
--summarize-model <model> Model for the summarization pass (default: sonnet)
```

**Examples:**
```bash
smarthandoff route --to gemini
smarthandoff route --to codex
smarthandoff route --auto
smarthandoff route --to gemini --preview
smarthandoff route --to gemini --include-diffs
smarthandoff route --to gemini --budget 30000
smarthandoff route --to gemini --summarize
smarthandoff route --to gemini --summarize --summarize-model sonnet
```

**Expected output:**
```
Building handoff for gemini...
  ✓ Session parsed (2 goals, 8 files)
  ✓ Goal: Implement fromClaudeLogs JSONL parser
  ✓ Blocker: Tests failing on JSONL extraction

  ✓ Compressed: 4,821 tokens (budget: 50,000)

Delivering to gemini...
  ✓ Written: GEMINI.md

Run: cat .smarthandoff/latest.md | gemini -i "You are resuming a coding task. Context is above."
```

---

### `smarthandoff snapshot`

Capture current session state and save a handoff without routing anywhere.

**What it does:**
Same as `route` up through the merge step — reads, collects, merges, saves. Does not render an adapter output or deliver. Useful for saving state before you decide where to go, or as a checkpoint during a long session.

**Flags:**
```
--mode <mode>        lean | rich | debug (default: rich)
--session-id <id>    Specific Claude session ID
--budget <tokens>    Override token budget
--note <text>        Append a manual note to the handoff
--source <source>         manual | precompact | stop (for analytics)
--print                   Also print a summary to stdout
--summarize               LLM summarization pass for higher-quality handoff
--summarize-model <model> Model for the summarization pass (default: sonnet)
```

**Examples:**
```bash
smarthandoff snapshot
smarthandoff snapshot --mode lean
smarthandoff snapshot --note "focus on the auth module next"
smarthandoff snapshot --print
smarthandoff snapshot --summarize --print
```

**Expected output:**
```
✓ Handoff created: shoff_1777385087720_manual
  Goals:     2
  Decisions: 4
  Files:     8
  Blockers:  1
  Tokens:    ~12,340 raw
```

---

### `smarthandoff resume`

Generate a briefing from a previously saved handoff and deliver it to a target tool.

**What it does:**
Loads a saved `.smarthandoff/handoffs/<id>.json` (or `latest.json`), runs it through the adapter for the specified target, and delivers. Does not re-read the transcript — uses the already-extracted snapshot. Use this when you saved a snapshot earlier and now know where you want to go.

**Flags:**
```
--id <handoffId>     Handoff ID to resume from (default: most recent)
--to <tool>          Target tool (default: generic)
--budget <tokens>    Override token budget
--mode <mode>        lean | rich
--copy               Force copy to clipboard
--print              Print briefing to stdout instead of delivering
```

**Examples:**
```bash
smarthandoff resume --to gemini
smarthandoff resume --to codex
smarthandoff resume --id shoff_1777385087720_manual --to cursor
smarthandoff resume --to claude --print
```

---

### `smarthandoff analyze`

Inspect a handoff: what was extracted, how tokens are allocated, confidence scores.

**What it does:**
Loads a handoff and shows a visual breakdown of what was extracted from each source and how the token budget would be split across sections for a given target tool.

**Flags:**
```
--id <handoffId>     Handoff to analyze (default: most recent)
--target <tool>      Show allocation for this target (default: gemini)
--verbose            Dump full JSON of the handoff
```

**Examples:**
```bash
smarthandoff analyze
smarthandoff analyze --target codex
smarthandoff analyze --id shoff_1777385087720_manual --verbose
```

**Expected output:**
```
HANDOFF ANALYSIS: shoff_1777385087720_manual
Created: 2026-04-29T12:34:56Z | Source: claude-code

EXTRACTION SOURCES
  ├── claude-code: session a1b2c3d4
  └── Raw token count: ~12,340

TOKEN ALLOCATION (target: gemini, budget: 50,000)
  Goal         ████░░░░░░░░░░░░░░░░ ~4,000 tokens  (2 goals)
  Decisions    ████░░░░░░░░░░░░░░░░ ~4,000 tokens  (4 decisions)
  Files        ███████░░░░░░░░░░░░░ ~7,000 tokens  (8 files)
  Blockers     ██░░░░░░░░░░░░░░░░░░ ~2,000 tokens  (1 blockers)
  Next steps   █░░░░░░░░░░░░░░░░░░░ ~1,000 tokens  (2 steps)
  CLAUDE.md    ██████░░░░░░░░░░░░░░ ~6,000 tokens  (1 files)

CONFIDENCE SCORES
  Overall:     84%
  Decision:    90%  "decided to use vitest over jest for ESM compatibility..."
  Decision:    75%  "rather than parsing tool_result events, extract from ass..."
```

---

### `smarthandoff list`

List all saved handoffs for the current project.

**Flags:**
```
--limit <n>    Number to show (default: 10)
```

**Example:**
```bash
smarthandoff list
```

**Expected output:**
```
SMART HANDOFFS — /Users/you/my-project

  shoff_1777385087720_manual   2 hours ago   Implement fromClaudeLogs JSONL parser
  shoff_1777385162745_manual   1 hour ago    Fix budget allocator scaling
  shoff_1777385231291_manual   30 mins ago   Add decision noise filters

Total: 3 handoffs
Run: smarthandoff resume --id <id> --to <tool>
```

---

## Summarization Pass

The `--summarize` flag adds an optional LLM pass after deterministic extraction. It feeds the full cleaned session transcript to an LLM and asks it to rewrite every text field — goal title, decisions with rationale, file summaries, blockers, next steps — producing a handoff that reads like a PR description rather than a pattern-match dump.

**What it improves:**

| Field | Deterministic (default) | With `--summarize` |
|-------|------------------------|---------------------|
| `goal.title` | First 80 chars of first user message | "Build smart-handoff CLI: JSONL extraction + LLM summarize pass" |
| `goal.description` | Raw first message | 3–5 sentence summary of what was built, the approach, and current status |
| `decisions` | Pattern-matched sentences ("decided", "rather than") | Real choices including implicit ones, each with a rationale |
| `blockers` | Last user message if error keywords present | The actual unresolved problem, or empty if session ended cleanly |
| `filesChanged[].summary` | First non-comment line of written code | "Adds goal extraction from first user message in the JSONL transcript" |
| `nextSteps` | Often missing | Specific and ordered — names the file, function, or command |

**How it works:**

1. Reconstructs the full conversation as clean `User: / Assistant:` turns (after noise stripping)
2. Sends it to the LLM along with the deterministically extracted handoff as a structural scaffold
3. LLM rewrites only the text fields — file paths, timestamps, IDs are never touched
4. Falls back silently to the deterministic handoff on any failure

**Current provider: `claude-cli`**

Uses the `claude` binary already installed by Claude Code. No additional API key needed — uses your existing login via keychain auth.

```bash
smarthandoff route --to gemini --summarize
smarthandoff route --to gemini --summarize --summarize-model sonnet
```

**Upcoming: multi-provider support** — see [Implementation Plan & Status](#implementation-plan--status) for the roadmap to add Anthropic SDK, Gemini, and OpenAI as provider options.

---

## Adapters

Each adapter renders the compressed `Handoff` into the format that target tool expects, and specifies how to deliver it.

### `gemini` — 50,000 token budget

**Delivery:** stdin pipe  
**Unique features:** Writes `GEMINI.md` to project root with persistent stack context; includes full `CLAUDE.md` content (within budget); adds search grounding note for npm packages

**Output format:**
```markdown
## CONTEXT (resuming from claude-code)
*Generated by Smart Handoff — 2026-04-29T12:34:56Z*

### Goal
**Implement fromClaudeLogs JSONL parser**
[first user message, up to token budget]

### Files changed
**packages/core/src/builders/fromClaudeLogs.ts** (modified, high)
Summary: export async function fromClaudeLogs(

### Open blocker
Tests failing on JSONL extraction
Error: `Expected tool calls in assistant events`

### Decisions made (do not re-suggest)
- Decided to use vitest over jest for ESM compatibility
- Rather than parsing tool_result events, extract from assistant messages

### Next step
Fix the JSONL extraction to look at assistant events, not separate tool_result type

### Stack
TypeScript ^5.4.0, Vitest, Node v22.19.0
Test: `pnpm test`

### Project instructions (CLAUDE.md)
[CLAUDE.md content if present]
```

**Launch command:** `cat .smarthandoff/latest.md | gemini -i "You are resuming a coding task. Context is above."`

**Also writes:** `GEMINI.md` (persistent project context for future Gemini CLI sessions)

---

### `codex` — 8,000 token budget

**Delivery:** stdin pipe  
**Unique features:** Patches `AGENTS.md` with project conventions; uses structured `TASK:/FILE:/FAILING:/VERIFY:` prefix format; exact `file:line` references for errors; sandbox flag guidance

**Output format:**
```
TASK: Implement fromClaudeLogs JSONL parser
FILE: packages/core/src/builders/fromClaudeLogs.ts (modified)
FAILING: packages/core/src/builders/fromClaudeLogs.ts:87
  Error: Expected tool calls in assistant events
HYPOTHESIS: Fix extraction to look at assistant events, not tool_result type
VERIFY: pnpm test
DECISIONS: Use vitest over jest; extract from assistant messages not tool_result
STACK: TypeScript ^5.4.0, Node v22.19.0
SCOPE: Do not change files outside packages/core/src/builders/
```

**Launch command:** `cat .smarthandoff/latest.md | codex exec "Fix the failing issue. Context above." --sandbox workspace-write`

---

### `cursor` — 20,000 token budget

**Delivery:** file write  
**Unique features:** Writes `.cursor/rules/handoff.mdc`; uses `@filename` references for changed files so Cursor auto-attaches them; MDC front matter format

**Output format:**
```markdown
---
description: Smart Handoff — session context
alwaysApply: true
---

## Resuming session

**Goal:** Implement fromClaudeLogs JSONL parser

## Files changed
- @packages/core/src/builders/fromClaudeLogs.ts (modified)
- @packages/core/src/__tests__/fromClaudeLogs.test.ts (modified)

## Open blocker
Tests failing on JSONL extraction

## Decisions (do not re-suggest)
- Use vitest over jest for ESM compatibility

## Next step
Fix the JSONL extraction to look at assistant events
```

---

### `claude` — 15,000 token budget

**Delivery:** clipboard  
**Unique features:** Shortest format; does not include CLAUDE.md (already on disk); includes Claude auto-memory fragments if present; mirrors `/compact` output style

**Use case:** Resuming in a new Claude Code session after rate limit, or handing off to a colleague using Claude.

**Launch:** Open Claude Code, paste the clipboard content as your first message.

---

### `chatgpt` — 20,000 token budget

**Delivery:** two-part clipboard (system prompt first, then user message)  
**Unique features:** Splits into a `SYSTEM PROMPT:` and `FIRST MESSAGE:` section; human-readable narrative format; no terminal commands

**Output format:**
```
SYSTEM PROMPT:
You are a senior software engineer continuing work from an AI coding session.
Stack: TypeScript ^5.4.0, Node v22.19.0. Follow existing patterns. Do not refactor what is already working.

---

FIRST MESSAGE:
I'm continuing a coding session. Rate limit hit on Claude, switching to you.

**What we were building:** Implement fromClaudeLogs JSONL parser
...
```

---

### `generic` — 10,000 token budget

**Delivery:** clipboard  
**Use case:** Any tool not listed above. Plain markdown, no tool-specific formatting.

---

## Claude Code Plugin

The plugin adds three capabilities on top of the CLI, available without any npm install:

### `/handoff` skill

A slash command that generates a briefing from inside Claude Code without running any CLI. It reads the current conversation directly (as the AI has access to it), extracts signal, formats a target-tool briefing, writes it to `.smarthandoff/latest.md`, and prints the launch command.

```
/handoff               → defaults to gemini
/handoff --to codex
/handoff --to cursor
/handoff --mode lean
/handoff --preview
```

### StopFailure hook

Fires automatically when Claude Code hits a rate limit. Calls:
```bash
smarthandoff route --to <defaultTarget> --trigger rate_limit
```
This means hitting a rate limit automatically routes your session to the configured target tool with full context. Zero manual steps.

### PreCompact hook

Fires asynchronously when the context window is filling up (before Claude compacts it). Calls:
```bash
smarthandoff snapshot --mode lean --source precompact
```
This creates a lean checkpoint before compaction so you never lose state.

### Install

```
/plugin install smart-handoff
```

Or via `smarthandoff init` which registers the hooks in `~/.claude/settings.json`.

---

## Monorepo Structure

```
smart-handoff/
├── packages/core/          @smarthandoff/core — library
├── apps/cli/               @smarthandoff/cli — CLI binary
├── plugins/claude-code/    smart-handoff Claude Code plugin
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── .smarthandoff/          project handoff storage (see below)
```

```bash
pnpm install        # install all deps
pnpm build          # build all packages
pnpm test           # run all tests (42 tests, 5 suites)
```

Test suites:
- `budgetAllocator.test.ts` — token budget allocation (7 tests)
- `stripNoise.test.ts` — JSONL noise filtering (8 tests)
- `merge.test.ts` — handoff partial merging (8 tests)
- `fromClaudeLogs.test.ts` — JSONL extraction (8 tests)
- `adapters.test.ts` — all adapter output formats (11 tests)

---

## Project Storage

```
your-project/
├── .smarthandoff/
│   ├── config.yaml          ← commit this
│   ├── handoffs/            ← commit these (session history)
│   │   └── shoff_*.json     ← one per snapshot
│   ├── cache/               ← gitignored (computed caches)
│   ├── events.jsonl         ← gitignored (analytics: ROUTE_TRIGGERED etc.)
│   └── latest.json          ← gitignored (most recent handoff, for resume)
├── GEMINI.md                ← written by gemini adapter (persistent project context)
└── .cursor/rules/
    └── handoff.mdc          ← written by cursor adapter
```

**Config file (`.smarthandoff/config.yaml`):**
```yaml
projectId: my-project
defaultTarget: gemini
collectors:
  claudeLogs:
    enabled: true
  git:
    enabled: true
    includeDiffs: false
  memory:
    enabled: true
compression:
  defaultMode: rich
  profiles:
    lean:   { budget: 4000 }
    rich:   { budget: null }      # uses tool default
    debug:  { budget: 100000 }
policy:
  autoSnapshotOnRateLimit: true
  autoSnapshotOnPreCompact: true
  minFilesChanged: 1
```

---

## Implementation Plan & Status

### Initial Plan

The project was designed in four milestones, targeting complete delivery in 8 weeks:

| Milestone | Scope | Target |
|-----------|-------|--------|
| 1 | Core parser + all adapters + CLI + plugin | Week 1–2 |
| 2 | Publishing, marketplace, blog post | Week 3–4 |
| 3 | Summarization (optional LLM path) | Week 5–6 |
| 4 | IDE extensions beyond Claude Code | Week 7–8 |

### Milestone 1 — Complete ✅

**Core library (`@smarthandoff/core`):**
- [x] `types.ts` — full Handoff schema (all interfaces)
- [x] `schema.ts` — Zod validation with `validateHandoff()`
- [x] `stripNoise.ts` — JSONL event filter; keeps Write/Edit assistant blocks even when no text content
- [x] `fromClaudeLogs.ts` — JSONL parser: goal, files, blocker, decisions, `inferFileSummary`; system tag stripping; internal path filtering
- [x] `fromGit.ts` — git status + diff stats; filters `.smarthandoff/` artifacts
- [x] `fromMemory.ts` — Claude auto-memory reader; path encoding fix for spaces
- [x] `fromManual.ts` — user notes builder
- [x] `merge.ts` — Partial<Handoff>[] combiner with dedup
- [x] `budgetAllocator.ts` — per-tool token budgets; proportional scaling with `--budget` override
- [x] `compress.ts` — file-fits-budget fast path; summary-first budget allocation; no unnecessary truncation
- [x] `compressDiffs.ts` — sentence-boundary truncation (`compressText`); no mid-word cuts
- [x] All 6 adapters: `gemini`, `codex`, `cursor`, `claude`, `chatgpt`, `generic`
- [x] `enhance/prompt.ts` — full conversation reconstruction + LLM summarization prompt
- [x] `enhance/providers/claudeCli.ts` — subprocess provider via `claude --print`; `structured_output` + markdown fallback parsing
- [x] `enhance/summarize.ts` — LLM enhancement orchestrator; graceful fallback on failure
- [x] `policy/evaluator.ts` — should-handoff policy engine
- [x] 42 passing unit tests across 5 suites

**Bug fixes shipped:**
- [x] JSONL format: tool calls are content blocks inside `assistant` events, not separate `tool_use` events
- [x] Claude Code path encoding: replace both `/` AND whitespace with `-`
- [x] `--json-schema` dropped from claude CLI (triggers multi-turn agentic flow → timeouts); replaced with `--system-prompt` + regex fallback
- [x] Fixed sections in `budgetAllocator` now scale proportionally with `--budget` override
- [x] `compressFiles` no longer truncates summaries when file fits in per-file token cap

**CLI (`@smarthandoff/cli`):**
- [x] `init` — project setup + hook registration + gitignore
- [x] `route` — collect → merge → [summarize] → compress → deliver; `--summarize`, `--summarize-model`
- [x] `snapshot` — collect + save; `--summarize`, `--summarize-model`
- [x] `resume` — load saved handoff → deliver to any target
- [x] `analyze` — token allocation visualization + confidence scores
- [x] `list` — show all saved handoffs
- [x] `toolDetector.ts` — PATH-based tool detection including `claude`
- [x] `analytics.ts` — event emission to `events.jsonl`
- [x] All delivery modes: pipe, clipboard, file-write, two-part-clipboard
- [x] `--auto` flag with ranked tool detection

**Claude Code plugin:**
- [x] `manifest.json` — plugin definition
- [x] `/handoff` skill — in-editor briefing generator with `--summarize` deep-understanding mode
- [x] `stopFailure.sh` — auto-route on rate limit
- [x] `preCompact.sh` — async snapshot on context fill

### Milestone 2 — Multi-Provider Summarization (Planned)

Add Anthropic SDK, Gemini, and OpenAI as pluggable providers for the `--summarize` pass, so users can bring their own API key instead of relying on the `claude` CLI binary.

See the detailed design in the section below.

- [ ] `enhance/providers/index.ts` — provider factory + auto-detection from env vars
- [ ] `enhance/providers/anthropic.ts` — Anthropic SDK with tool-use structured output
- [ ] `enhance/providers/gemini.ts` — Google AI SDK with `responseSchema` JSON mode
- [ ] `enhance/providers/openai.ts` — OpenAI SDK with `response_format` JSON schema mode
- [ ] `--summarize-provider` flag on `route` and `snapshot`
- [ ] Auto-detect provider from env vars (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`)
- [ ] Provider-specific default models (`gemini-2.0-flash`, `gpt-4o-mini`, `claude-sonnet-4-6`)
- [ ] Config file: `summarize.provider`, `summarize.model`

### Milestone 3 — Publishing & Distribution (Planned)

- [ ] `npm publish @smarthandoff/core@0.1.0` and `@smarthandoff/cli@0.1.0`
- [ ] Submit `smart-handoff` plugin to Claude Code marketplace
- [ ] Blog post: "Smart Handoff — zero-friction AI session continuity"

### Milestone 4 — Extended Surfaces (Planned)

- [ ] VS Code extension with sidebar UI
- [ ] JetBrains plugin
- [ ] GitHub Action: auto-snapshot on PR open

---

## Multi-Provider Summarization — Design

The `--summarize` flag currently uses the `claude` CLI binary (zero-config for Claude Code users). This section documents the planned extension to support any LLM provider via API key.

### Provider interface

Every provider implements the same contract:

```typescript
// packages/core/src/enhance/providers/index.ts
export interface LLMProvider {
  call(prompt: string, schema: object): Promise<EnhancedHandoff>;
}

export type ProviderName = 'claude-cli' | 'anthropic' | 'gemini' | 'openai';
```

### Provider selection

**Priority order when `--summarize` is passed with no `--summarize-provider`:**

1. `ANTHROPIC_API_KEY` env var → `anthropic` provider
2. `GEMINI_API_KEY` or `GOOGLE_API_KEY` env var → `gemini` provider
3. `OPENAI_API_KEY` env var → `openai` provider
4. `claude` binary in PATH → `claude-cli` provider
5. None found → error with helpful message listing what to set

Explicit override always wins: `--summarize-provider gemini`

### CLI flags

```
--summarize                         Enable LLM summarization pass
--summarize-provider <p>            claude-cli | anthropic | gemini | openai
--summarize-model <model>           Override default model for the chosen provider
```

API keys are **never passed as flags** — always via environment variables:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=AIza...
export OPENAI_API_KEY=sk-...
```

### Provider defaults

| Provider | Default model | Structured output mechanism |
|----------|--------------|----------------------------|
| `claude-cli` | `sonnet` | `--system-prompt` + markdown extraction fallback |
| `anthropic` | `claude-sonnet-4-6` | `tools` parameter with JSON schema (tool-use mode) |
| `gemini` | `gemini-2.0-flash` | `responseMimeType: 'application/json'` + `responseSchema` |
| `openai` | `gpt-4o-mini` | `response_format: { type: 'json_schema', json_schema }` |

### Optional dependencies

Providers are **optional peer dependencies** — only install what you use. The SDK is lazy-loaded with a helpful install hint if missing:

```
# For Anthropic SDK provider:
npm install @anthropic-ai/sdk

# For Gemini provider:
npm install @google/generative-ai

# For OpenAI provider:
npm install openai
```

If you run `--summarize-provider gemini` without the SDK installed:
```
✗ Gemini provider requires: npm install @google/generative-ai
  Or switch to: --summarize-provider claude-cli (no install needed)
```

### Config file integration

```yaml
# .smarthandoff/config.yaml
summarize:
  provider: gemini          # auto-detect if omitted
  model: gemini-2.0-flash   # provider default if omitted
  # API key via GEMINI_API_KEY env var — never in config
```

### New files

```
packages/core/src/enhance/
├── providers/
│   ├── claudeCli.ts     ← existing
│   ├── anthropic.ts     ← new: @anthropic-ai/sdk tool-use structured output
│   ├── gemini.ts        ← new: @google/generative-ai responseSchema JSON mode
│   ├── openai.ts        ← new: openai response_format JSON schema mode
│   └── index.ts         ← new: factory(options) → LLMProvider + auto-detect logic
└── summarize.ts         ← update: use factory instead of hardcoded claudeCli
```

---

## Development

```bash
pnpm install          # install dependencies
pnpm build            # build core + CLI
pnpm test             # run 42 unit tests
pnpm --filter @smarthandoff/core build
pnpm --filter @smarthandoff/cli build
```

### End-to-end CLI smoke tests

Run these after `pnpm build` from the repo root:

```bash
# Basic snapshot (deterministic extraction, no LLM)
node apps/cli/dist/index.js snapshot --print

# Snapshot with LLM summarization — claude-cli (no API key needed, uses existing Claude Code login)
node apps/cli/dist/index.js snapshot --summarize --print

# Snapshot with specific provider
ANTHROPIC_API_KEY=<key> node apps/cli/dist/index.js snapshot --summarize --summarize-provider anthropic --print
GEMINI_API_KEY=<key>    node apps/cli/dist/index.js snapshot --summarize --summarize-provider gemini --print
OPENAI_API_KEY=<key>    node apps/cli/dist/index.js snapshot --summarize --summarize-provider openai --print

# Override model for a provider
GEMINI_API_KEY=<key> node apps/cli/dist/index.js snapshot --summarize --summarize-provider gemini --summarize-model gemini-2.0-flash --print

# Route to a specific tool (preview without delivering)
node apps/cli/dist/index.js route --to gemini --preview
node apps/cli/dist/index.js route --to claude --preview
node apps/cli/dist/index.js route --to codex --preview

# Route with auto-detect
node apps/cli/dist/index.js route --auto --preview

# Route + summarization in one command
GEMINI_API_KEY=<key> node apps/cli/dist/index.js route --to gemini --summarize --summarize-provider gemini --preview

# Analyze token budget for last handoff
node apps/cli/dist/index.js analyze

# List saved handoffs
node apps/cli/dist/index.js list

# Resume from latest snapshot
node apps/cli/dist/index.js resume --to gemini --preview
node apps/cli/dist/index.js resume --to claude --preview

# Init (creates .smarthandoff/, registers PreCompact + StopFailure hooks)
node apps/cli/dist/index.js init
```

**Adding a new adapter:**
1. Add the target name to `TargetTool` in `packages/core/src/types.ts`
2. Add a budget entry to `TOOL_BUDGETS` in `budgetAllocator.ts`
3. Add a budget allocation case to `allocateBudget()`
4. Create `packages/core/src/adapters/<name>.ts` exporting `to<Name>(handoff, options)`
5. Register it in `packages/core/src/adapters/index.ts`
6. Add a test case to `adapters.test.ts`

**Handoff ID format:** `shoff_<unix_ms>_<source>` where source is `manual`, `rate_limit`, or `precompact`.

---

## License

MIT
