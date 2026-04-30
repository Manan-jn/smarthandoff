# Smart Handoff

Zero-friction AI session continuity across any tool, any rate limit.

When Claude hits a rate limit, one command switches you to Gemini CLI with full context — goal, files changed, blocker, decisions — in under 30 seconds.

**Zero LLM calls. Fully deterministic. No API keys. No cost.**

---

## Table of Contents

1. [What It Is](#what-it-is)
2. [The Problem](#the-problem)
3. [How It Works](#how-it-works)
4. [Architecture](#architecture)
5. [Data Model](#data-model)
6. [Quick Start](#quick-start)
7. [Commands](#commands)
8. [Adapters](#adapters)
9. [Claude Code Plugin](#claude-code-plugin)
10. [Monorepo Structure](#monorepo-structure)
11. [Project Storage](#project-storage)
12. [Implementation Plan & Status](#implementation-plan--status)
13. [Development](#development)

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
--trigger <trigger>  manual | rate_limit | precompact (for analytics, default: manual)
--session-id <id>    Use a specific Claude session instead of the most recent
```

**Examples:**
```bash
smarthandoff route --to gemini
smarthandoff route --to codex
smarthandoff route --auto
smarthandoff route --to gemini --preview
smarthandoff route --to gemini --include-diffs
smarthandoff route --to gemini --budget 30000
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
--source <source>    manual | precompact | stop (for analytics)
--print              Also print a summary to stdout
```

**Examples:**
```bash
smarthandoff snapshot
smarthandoff snapshot --mode lean
smarthandoff snapshot --note "focus on the auth module next"
smarthandoff snapshot --print
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

Everything in the original Milestone 1–4 plan that makes up a working v1.0 is done:

**Core library (`@smarthandoff/core`):**
- [x] `types.ts` — full Handoff schema (all interfaces)
- [x] `schema.ts` — Zod validation with `validateHandoff()`
- [x] `stripNoise.ts` — JSONL event filter (removes tool_result, reads, bash stdout)
- [x] `fromClaudeLogs.ts` — JSONL parser: goal, files, blocker, decisions, `inferFileSummary`
- [x] `fromGit.ts` — git status + diff stats builder
- [x] `fromMemory.ts` — Claude auto-memory reader
- [x] `fromManual.ts` — user notes builder
- [x] `merge.ts` — Partial<Handoff>[] combiner with dedup
- [x] `budgetAllocator.ts` — per-tool token budgets, proportional scaling
- [x] `compress.ts` — section-level compression with sentence-boundary truncation
- [x] `compressDiffs.ts` — diff-aware text compression
- [x] All 6 adapters: `gemini`, `codex`, `cursor`, `claude`, `chatgpt`, `generic`
- [x] `policy/evaluator.ts` — should-handoff policy engine
- [x] 42 passing unit tests across 5 suites

**CLI (`@smarthandoff/cli`):**
- [x] `init` — project setup + hook registration + gitignore
- [x] `route` — end-to-end: collect → merge → compress → deliver
- [x] `snapshot` — collect + save without routing
- [x] `resume` — load saved handoff → deliver to any target
- [x] `analyze` — token allocation visualization + confidence scores
- [x] `list` — show all saved handoffs
- [x] `toolDetector.ts` — PATH-based tool detection
- [x] `analytics.ts` — event emission to `events.jsonl`
- [x] All delivery modes: pipe, clipboard, file-write, two-part-clipboard
- [x] `--auto` flag with ranked tool detection
- [x] Claude Code path encoding fix (replaces `/` and whitespace with `-`)
- [x] Relative path output + internal file filter

**Claude Code plugin:**
- [x] `manifest.json` — plugin definition
- [x] `/handoff` skill — in-editor briefing generator
- [x] `stopFailure.sh` — auto-route on rate limit
- [x] `preCompact.sh` — async snapshot on context fill

### What's Next

- [ ] `npm publish @smarthandoff/core@0.1.0` and `@smarthandoff/cli@0.1.0`
- [ ] Submit `smart-handoff` plugin to Claude Code marketplace
- [ ] End-to-end smoke test on a real Claude Code → Gemini CLI handoff
- [ ] `summarize.ts` — optional LLM-powered summarization pass (via Anthropic SDK)
- [ ] Blog post: "Smart Handoff — zero-friction AI session continuity"
- [ ] VS Code extension surface (post-v1)

---

## Development

```bash
pnpm install          # install dependencies
pnpm build            # build core + CLI
pnpm test             # run 42 unit tests
pnpm --filter @smarthandoff/core build
pnpm --filter @smarthandoff/cli build
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
