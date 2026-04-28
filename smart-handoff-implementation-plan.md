# Smart Handoff — Complete Implementation Plan

> Version 1.0 | April 2026 | Status: Ready to Execute

---

## Table of Contents

1. [What We Are Building](#1-what-we-are-building)
2. [Problem Statement](#2-problem-statement)
3. [Product Vision and Goals](#3-product-vision-and-goals)
4. [Features — Complete List](#4-features--complete-list)
5. [User Interactions — Every Flow](#5-user-interactions--every-flow)
6. [Architecture — System Design](#6-architecture--system-design)
7. [Data Model — Canonical Schema](#7-data-model--canonical-schema)
8. [Core Library Internals](#8-core-library-internals)
9. [Per-Tool Adapters — Full Spec](#9-per-tool-adapters--full-spec)
10. [CLI — Every Command](#10-cli--every-command)
11. [Claude Code Plugin](#11-claude-code-plugin)
12. [Policy Engine — Smart Triggers](#12-policy-engine--smart-triggers)
13. [Analytics](#13-analytics)
14. [Monorepo Setup — Step by Step](#14-monorepo-setup--step-by-step)
15. [Implementation Milestones](#15-implementation-milestones)
16. [Testing Strategy](#16-testing-strategy)
17. [Publishing and Distribution](#17-publishing-and-distribution)
18. [File and Directory Reference](#18-file-and-directory-reference)

---

## 1. What We Are Building

**Smart Handoff** is a tool that captures the state of an AI coding session the moment it ends — whether due to a rate limit, context window exhaustion, or intentional switching — and reconstructs that state as a ready-to-use, model-aware briefing for the next tool or session.

It is not a session exporter. It is not a transcript formatter. It is a **resumable state machine for AI coding sessions**.

The product has three surfaces:

- `@smarthandoff/core` — npm library, the engine anyone can build on
- `smarthandoff` — npm CLI, the primary user interface
- Claude Code plugin — in-editor UX built on top of the CLI

### Name

Package: `@smarthandoff/core`, `@smarthandoff/cli`  
CLI binary: `smarthandoff` (alias: `shoff`)  
Claude Code plugin: `smart-handoff`

---

## 2. Problem Statement

When an AI coding session ends unexpectedly — rate limit hit, context window full, or deliberate tool switch — developers face a brutal choice: start over, or spend 10–20 minutes re-explaining their codebase, decisions, and current state to the next tool.

Today's "solutions":

- **session-report** (npm): Exports raw session text. Dumps everything — bash outputs, file reads, retry noise — into a blob that immediately hits the new tool's context window too.
- **Copy-paste**: Same problem. Raw transcript is 85% noise, 15% signal.
- **Manual summary**: Takes 10 minutes. Inconsistent. Loses rationale and decisions.
- **claude-mem / cmem**: Captures observations to a parallel memory store. Never produces a resumable state. Doesn't know about the target tool's format.

**The specific gap:** No tool produces a *compressed, structured, model-aware briefing* targeted at a specific destination tool — one that the destination tool can act on immediately, using its optimal input format, within its token budget.

---

## 3. Product Vision and Goals

**Vision:** Zero-friction AI session continuity across any tool, any machine, any rate limit.

**Primary goal:** When you hit Claude's rate limit, you type one command and Gemini CLI starts exactly where Claude left off — in under 30 seconds, with full context, without re-explaining anything.

**Secondary goals:**
- Make proactive snapshots automatic so you never lose work
- Let teams share session state across machines
- Give developers insight into their AI session patterns

**Non-goals for v1:**
- Real-time session sync
- Cloud storage / team sharing (v2)
- UI dashboard (v2)
- Training data generation (v3)

---

## 4. Features — Complete List

### Core features (v1)

| Feature | Description |
|---|---|
| Session extraction | Parse Claude Code JSONL transcripts into structured data |
| Git integration | Extract changed files, diffs, summaries from git status |
| Handoff schema | Canonical JSON object capturing complete session state |
| Budget-aware compression | Fit handoff within target tool's token budget |
| Claude Code adapter | Generates resume prompt for new Claude session |
| Gemini CLI adapter | Generates stdin pipe briefing + writes GEMINI.md |
| Codex CLI adapter | Generates prompt-plus-stdin briefing + patches AGENTS.md |
| Cursor adapter | Writes .cursor/rules/handoff.mdc file + clipboard text |
| ChatGPT adapter | Generates two-part clipboard (system prompt + first message) |
| Generic adapter | Universal markdown for any tool |
| CLI: init | Initialize project config + register Claude Code hooks |
| CLI: snapshot | Create handoff from current session state |
| CLI: resume | Generate target-tool prompt from saved handoff |
| CLI: route | One command: snapshot + compress + deliver to target tool |
| CLI: analyze | Show what was extracted, token allocation, what was dropped |
| CLI: list | List all saved handoffs for current project |
| Claude Code skill | /handoff slash command inside Claude Code |
| StopFailure hook | Auto-trigger on rate limit — generates handoff instantly |
| PreCompact hook | Auto-snapshot when context window fills (proactive) |
| --auto flag | Detect installed tools, pick best available target |

### v2 features (not in this plan)

- Team handoff sharing (S3/Cloudflare R2 backend)
- VS Code extension (separate from Claude Code plugin)
- Web dashboard for analytics
- Handoff quality scoring
- Cross-project knowledge mining

---

## 5. User Interactions — Every Flow

### Flow 1: Rate limit hit — immediate recovery

```
[Claude Code session running]
[Rate limit hit — StopFailure fires]
[smart-handoff hook runs automatically]

Terminal output:
  ⚡ Rate limit hit. Generating handoff...
  ✓ Session parsed (142 messages, 89K tokens)
  ✓ 3 files changed extracted from git
  ✓ Goal, blocker, decisions extracted
  ✓ Compressed to 8,200 tokens for Gemini CLI
  ✓ Briefing piped to gemini -i

[Gemini CLI opens with full context loaded]
[User continues immediately]
```

This flow requires zero user input. Everything is automatic.

### Flow 2: Proactive snapshot before switching

```
[User is mid-session, approaching rate limit]
[User types in terminal:]

$ smarthandoff route --to gemini

Output:
  Reading last Claude Code session...
  ✓ Session: my-app (abc123) — 67 messages
  ✓ Goal: JWT refresh middleware refactor
  ✓ Files: auth.ts, tokenRefresh.ts, auth.d.ts
  ✓ Blocker: auth.test.ts:84 failing
  ✓ Compressed: 7,800 tokens (budget: 50K)

  Delivering to Gemini CLI...
  $ gemini -i "[briefing]"

[Gemini CLI opens]
```

### Flow 3: Manual snapshot, decide later

```
$ smarthandoff snapshot --mode rich

Output:
  ✓ Handoff created: shoff_2026-04-27_abc123
  ✓ Saved: .smarthandoff/handoffs/shoff_abc123.json
  ✓ 4 goals, 3 decisions, 3 file changes, 1 blocker

Later:
$ smarthandoff resume --id shoff_abc123 --to codex

Output:
  ✓ Briefing generated for Codex CLI
  ✓ AGENTS.md patched with task state
  ✓ Copied to clipboard
  Run: cat .smarthandoff/cache/codex_abc123.md | codex exec "resume this task"
```

### Flow 4: Claude Code slash command

```
[Inside Claude Code session, user types:]
/handoff --to gemini

[Claude Code outputs:]
  Generating Smart Handoff...
  Reading current session context...

  ╔════════════════════════════════╗
  ║  SMART HANDOFF — READY         ║
  ╠════════════════════════════════╣
  ║  Target: Gemini CLI            ║
  ║  Tokens: 8,200 / 50,000        ║
  ║  Goal: JWT refresh refactor    ║
  ║  Files: 3 changed              ║
  ║  Blocker: auth.test.ts:84      ║
  ╚════════════════════════════════╝

  Briefing saved to: .smarthandoff/latest.md
  Run this command to switch:
  cat .smarthandoff/latest.md | gemini -i "Resume this task."
```

### Flow 5: --auto mode (no target specified)

```
$ smarthandoff route --auto

Output:
  Detecting available AI tools...
  ✓ gemini        — installed, free quota likely available
  ✓ codex         — installed
  ✗ cursor        — not detected in PATH
  ✗ claude        — same tool (rate limited)

  Recommendation: gemini (largest free context, 1M tokens)

  Proceed with gemini? [Y/n]: Y
  [routes to gemini]
```

### Flow 6: Analyze a handoff

```
$ smarthandoff analyze --id shoff_abc123

Output:
  HANDOFF ANALYSIS: shoff_abc123
  Created: 2026-04-27 14:32 | Source: claude-code

  EXTRACTION SOURCES
  ├── Claude logs: 142 messages → 18K signal tokens (after strip)
  ├── Git status:  3 files changed, +89/-12 lines
  └── CLAUDE.md:   found (2,400 tokens)

  TOKEN ALLOCATION (target: gemini, budget: 50,000)
  ├── Goal:        320 tokens   (1 goal)
  ├── Decisions:   890 tokens   (3 decisions, full rationale)
  ├── Files:       1,840 tokens (3 files, full diffs included)
  ├── Blocker:     210 tokens
  ├── Next step:   180 tokens
  ├── CLAUDE.md:   2,400 tokens (included — budget allows)
  └── Total:       5,840 tokens ✓ under budget

  WHAT WAS DROPPED
  └── Nothing — Gemini budget is generous

  CONFIDENCE SCORES
  ├── Goal extraction:     0.94 (first user message, clear)
  ├── Blocker extraction:  0.89 (last error in transcript)
  └── Decision extraction: 0.71 (pattern match, moderate)
```

---

## 6. Architecture — System Design

### Package structure

```
smart-handoff/                          ← monorepo root
├── package.json                        ← pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
│
├── packages/
│   └── core/                           ← @smarthandoff/core
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                ← public API
│           ├── types.ts                ← all interfaces
│           ├── schema.ts               ← JSON schema + zod validators
│           ├── builders/
│           │   ├── fromClaudeLogs.ts   ← JSONL parser
│           │   ├── fromGit.ts          ← git status/diff reader
│           │   ├── fromMemory.ts       ← Claude auto-memory reader
│           │   ├── fromManual.ts       ← manual note injection
│           │   └── merge.ts            ← partial → Handoff combiner
│           ├── compress/
│           │   ├── budgetAllocator.ts  ← per-section token budgets
│           │   ├── stripNoise.ts       ← JSONL noise stripping
│           │   ├── summarize.ts        ← pluggable summarizer
│           │   └── compressDiffs.ts    ← diff compression
│           ├── adapters/
│           │   ├── types.ts            ← AdapterOutput interface
│           │   ├── claude.ts           ← Claude Code adapter
│           │   ├── gemini.ts           ← Gemini CLI adapter
│           │   ├── codex.ts            ← Codex CLI adapter
│           │   ├── cursor.ts           ← Cursor file-write adapter
│           │   ├── chatgpt.ts          ← ChatGPT two-part adapter
│           │   └── generic.ts          ← Universal markdown adapter
│           ├── policy/
│           │   ├── evaluator.ts        ← shouldSnapshot() logic
│           │   └── config.ts           ← PolicyConfig type
│           └── analytics/
│               ├── events.ts           ← event types
│               └── writer.ts           ← JSONL event writer
│
├── apps/
│   └── cli/                            ← smarthandoff CLI
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                ← CLI entry point
│           ├── commands/
│           │   ├── init.ts
│           │   ├── snapshot.ts
│           │   ├── resume.ts
│           │   ├── route.ts
│           │   ├── analyze.ts
│           │   └── list.ts
│           ├── hooks/
│           │   ├── stopFailure.ts      ← rate limit auto-trigger
│           │   └── preCompact.ts       ← context window trigger
│           ├── deliver/
│           │   ├── pipe.ts             ← stdin pipe delivery
│           │   ├── clipboard.ts        ← clipboard delivery
│           │   ├── fileWrite.ts        ← file-write delivery
│           │   └── twoPartClipboard.ts ← ChatGPT two-part
│           ├── detect/
│           │   └── toolDetector.ts     ← which tools are installed
│           └── config.ts               ← load/save .smarthandoff/config.yaml
│
└── plugins/
    └── claude-code/                    ← Claude Code plugin
        ├── package.json
        └── src/
            ├── skill.md                ← /handoff slash command
            └── hooks/
                ├── stopFailure.json    ← hook config
                └── preCompact.json     ← hook config
```

### Data flow

```
JSONL transcript
    │
    ▼
fromClaudeLogs()
    │ strips noise (tool_result, file reads)
    │ keeps: user, assistant text, Write/Edit calls
    ▼
Partial<Handoff>
    │
    ├── fromGit() ──────── git status + diff → filesChanged[]
    ├── fromMemory() ───── ~/.claude/projects/.../memory/ → notes
    └── fromManual() ───── --note CLI flag → notes
    │
    ▼
merge() → Handoff (complete, uncompressed)
    │
    ▼
budgetAllocator(handoff, target, tokenBudget)
    │ assigns token budget per section
    │ based on: importance, recency, target tool
    ▼
compress(handoff, sectionBudgets)
    │ summarize() on long text blocks
    │ compressDiffs() on file changes
    ▼
Compressed Handoff
    │
    ▼
adapter[target](compressedHandoff) → AdapterOutput
    {
      text: string,
      deliveryMethod: 'pipe' | 'clipboard' | 'file-write' | 'two-part',
      filesToWrite?: { path: string, content: string }[],
      filesToCleanup?: string[],         // e.g. AGENTS.md patch
      launchCommand?: string             // e.g. gemini -i "..."
    }
    │
    ▼
deliver(adapterOutput) → tool receives context
```

---

## 7. Data Model — Canonical Schema

### Core types (`packages/core/src/types.ts`)

```typescript
export type Importance = 'critical' | 'high' | 'medium' | 'low';
export type TargetTool = 'claude' | 'gemini' | 'codex' | 'cursor' | 'chatgpt' | 'generic';
export type DeliveryMethod = 'pipe' | 'clipboard' | 'file-write' | 'two-part-clipboard';
export type HandoffMode = 'lean' | 'rich' | 'debug';

export interface HandoffGoal {
  id: string;
  title: string;
  description: string;
  status: 'in_progress' | 'completed' | 'blocked';
  sourceMessageIndex?: number;     // which message this was extracted from
}

export interface HandoffDecision {
  id: string;
  summary: string;
  rationale: string;
  alternatives?: string[];         // rejected approaches
  timestamp: string;
  confidence: number;              // 0-1, extraction confidence
}

export interface HandoffFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  summary: string;                 // human-readable: "Refactored auth middleware"
  diff?: string;                   // raw unified diff (compressed downstream)
  importance: Importance;
  linesAdded: number;
  linesRemoved: number;
  testsImpacted?: string[];        // test files that reference this file
}

export interface HandoffBlocker {
  id: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  errorMessage?: string;           // exact error text if present
  errorLocation?: string;          // file:line if present
  suggestedNextSteps?: string;
}

export interface HandoffNextStep {
  id: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  estimateMinutes?: number;
  specificAction?: string;         // one-sentence executable instruction
}

export interface HandoffProjectContext {
  stack: string[];                 // ["Node 20", "Express 5", "TypeScript strict"]
  testCommand?: string;            // "npm test"
  buildCommand?: string;           // "npm run build"
  claudeMdContent?: string;        // full CLAUDE.md if present
  agentsMdContent?: string;        // AGENTS.md if present
  packageJson?: {
    name: string;
    version: string;
    dependencies: Record<string, string>;
  };
}

export interface HandoffSource {
  tool: TargetTool | 'claude-code' | 'gemini-cli' | 'codex-cli' | 'cursor' | 'other';
  sessionId?: string;
  transcriptPath?: string;
  collectedAt: string;
}

export interface AdapterOutput {
  text: string;                    // the briefing text
  systemPrompt?: string;           // for ChatGPT two-part
  deliveryMethod: DeliveryMethod;
  targetTool: TargetTool;
  tokenCount: number;
  filesToWrite?: Array<{
    path: string;                  // relative to project root
    content: string;
    isTemporary: boolean;          // should be cleaned up after session
  }>;
  filesToCleanup?: string[];       // paths to delete after session ends
  launchCommand?: string;          // "gemini -i '...'" or similar
}

export interface Handoff {
  id: string;                      // shoff_<timestamp>_<sessionId prefix>
  projectId?: string;
  projectRoot: string;
  createdAt: string;
  createdBy: string;               // username@hostname
  mode: HandoffMode;
  
  // Core content
  goals: HandoffGoal[];
  decisions: HandoffDecision[];
  filesChanged: HandoffFileChange[];
  blockers: HandoffBlocker[];
  nextSteps: HandoffNextStep[];
  context: HandoffProjectContext;
  notes?: string;
  
  // Metadata
  sources: HandoffSource[];
  extractionConfidence: number;    // overall 0-1
  rawTokenCount: number;           // before compression
  
  // Cached adapter outputs (so we don't re-compress)
  cachedOutputs?: Partial<Record<TargetTool, AdapterOutput>>;
  
  metadata?: Record<string, unknown>;
}
```

### Storage

```
.smarthandoff/
├── config.yaml                 ← project config
├── handoffs/
│   ├── shoff_20260427_abc123.json    ← full uncompressed handoff
│   └── shoff_20260427_def456.json
├── cache/
│   ├── gemini_abc123.md        ← cached compressed output per target
│   └── codex_abc123.md
├── events.jsonl                ← analytics events
└── latest.md                  ← always the most recent handoff output
```

---

## 8. Core Library Internals

### 8.1 `fromClaudeLogs.ts` — JSONL parser

This is the most critical builder. It must be fast and accurate.

```typescript
// packages/core/src/builders/fromClaudeLogs.ts

interface ClaudeLogEvent {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'summary';
  message?: {
    role: string;
    content: string | ContentBlock[];
  };
  timestamp?: string;
  uuid?: string;
  parentUuid?: string;
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  name?: string;       // tool name for tool_use
  input?: unknown;     // tool arguments
  id?: string;
}

export async function fromClaudeLogs(
  transcriptPath: string,
  options: {
    maxMessages?: number;       // default: all
    includeThinking?: boolean;  // default: false
  } = {}
): Promise<Partial<Handoff>> {

  // Step 1: Read and parse JSONL
  const lines = await readLines(transcriptPath);
  const events: ClaudeLogEvent[] = lines
    .map(l => JSON.parse(l))
    .filter(Boolean);

  // Step 2: Strip noise — keep only signal
  // NOISE (strip): tool_result events, file read outputs, bash stdout
  // SIGNAL (keep): user messages, assistant text, Write/Edit tool_use calls
  const signalEvents = events.filter(e => {
    if (e.type === 'tool_result') return false;         // 85% of tokens, 5% of signal
    if (e.type === 'summary') return true;              // Claude's own compact summaries
    if (e.type === 'user') return true;
    if (e.type === 'assistant') return true;
    if (e.type === 'tool_use') {
      // Only keep file-write tool calls — these tell us what changed
      const name = (e.message?.content as ContentBlock[])?.[0]?.name;
      return name === 'Write' || name === 'Edit' || name === 'MultiEdit';
    }
    return false;
  });

  // Step 3: Extract goal (first substantive user message)
  const firstUserMessage = signalEvents
    .find(e => e.type === 'user')?.message?.content;
  const goal: HandoffGoal = {
    id: 'goal_1',
    title: extractTitle(String(firstUserMessage)),
    description: String(firstUserMessage),
    status: 'in_progress',
    sourceMessageIndex: 0,
  };

  // Step 4: Extract file changes from Write/Edit tool calls
  const filesChanged: HandoffFileChange[] = [];
  const fileWrites = signalEvents.filter(
    e => e.type === 'tool_use'
  );
  for (const write of fileWrites) {
    const blocks = write.message?.content as ContentBlock[];
    const toolBlock = blocks?.find(b => b.type === 'tool_use');
    if (!toolBlock?.input) continue;
    const input = toolBlock.input as { file_path?: string; new_content?: string };
    if (input.file_path) {
      filesChanged.push({
        path: input.file_path,
        status: 'modified',      // will be refined by fromGit
        summary: '',             // will be filled by summarizer
        importance: 'medium',    // will be scored by importance heuristic
        linesAdded: 0,
        linesRemoved: 0,
      });
    }
  }

  // Step 5: Extract blocker (last user message + last assistant message)
  const lastUserMessage = [...signalEvents]
    .reverse()
    .find(e => e.type === 'user')?.message?.content;
  const lastAssistantMessage = [...signalEvents]
    .reverse()
    .find(e => e.type === 'assistant')?.message?.content;

  const blocker: HandoffBlocker = {
    id: 'blocker_1',
    description: extractBlocker(String(lastUserMessage), String(lastAssistantMessage)),
    severity: 'high',
    errorMessage: extractErrorMessage(String(lastAssistantMessage)),
    errorLocation: extractErrorLocation(String(lastAssistantMessage)),
    suggestedNextSteps: extractNextStep(String(lastAssistantMessage)),
  };

  // Step 6: Extract decisions (pattern match on assistant messages)
  const decisions = extractDecisions(signalEvents);

  return {
    goals: [goal],
    filesChanged,
    blockers: blocker.description ? [blocker] : [],
    decisions,
    nextSteps: [{
      id: 'next_1',
      description: blocker.suggestedNextSteps || 'Continue from where we left off',
      priority: 'high',
      specificAction: blocker.suggestedNextSteps,
    }],
  };
}

// Pattern matching for decisions
function extractDecisions(events: ClaudeLogEvent[]): HandoffDecision[] {
  const DECISION_PATTERNS = [
    /\b(decided|choosing|chose|going with|we('ll| will) use)\b/i,
    /\b(not using|avoiding|rejected|instead of|rather than)\b/i,
    /\b(the reason|because|rationale|trade-?off)\b/i,
  ];
  
  const decisions: HandoffDecision[] = [];
  let id = 0;
  
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const text = extractText(event);
    const sentences = text.split(/[.!?]+/);
    
    for (const sentence of sentences) {
      if (DECISION_PATTERNS.some(p => p.test(sentence)) && sentence.length > 30) {
        decisions.push({
          id: `decision_${++id}`,
          summary: sentence.trim().slice(0, 200),
          rationale: '',
          timestamp: event.timestamp || new Date().toISOString(),
          confidence: 0.7,
        });
      }
    }
  }
  
  return decisions.slice(0, 10); // cap at 10 decisions
}
```

### 8.2 `fromGit.ts` — git integration

```typescript
// packages/core/src/builders/fromGit.ts

import { execSync } from 'node:child_process';

export async function fromGit(
  repoPath: string,
  options: { includeDiffs?: boolean } = {}
): Promise<Partial<Handoff>> {

  // Get changed files
  const statusOutput = execSync('git status --porcelain=v1', {
    cwd: repoPath, encoding: 'utf8'
  });

  const filesChanged: HandoffFileChange[] = statusOutput
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const statusCode = line.slice(0, 2).trim();
      const filePath = line.slice(3).trim();
      return {
        path: filePath,
        status: parseGitStatus(statusCode),
        summary: '',
        importance: scoreImportance(filePath),
        linesAdded: 0,
        linesRemoved: 0,
      };
    });

  // Get diff stats (line counts)
  for (const file of filesChanged) {
    try {
      const diffStat = execSync(`git diff --numstat HEAD -- "${file.path}"`, {
        cwd: repoPath, encoding: 'utf8'
      });
      const [added, removed] = diffStat.trim().split('\t');
      file.linesAdded = parseInt(added) || 0;
      file.linesRemoved = parseInt(removed) || 0;
    } catch { /* file might be new/untracked */ }
  }

  // Get actual diffs if requested
  if (options.includeDiffs) {
    for (const file of filesChanged) {
      try {
        file.diff = execSync(`git diff HEAD -- "${file.path}"`, {
          cwd: repoPath, encoding: 'utf8', maxBuffer: 100 * 1024
        });
      } catch { /* ignore */ }
    }
  }

  // Score importance based on file type and location
  for (const file of filesChanged) {
    file.importance = scoreImportance(file.path);
    // Find test files that import this file
    file.testsImpacted = findImpactedTests(file.path, repoPath);
  }

  return { filesChanged };
}

function scoreImportance(filePath: string): Importance {
  if (filePath.includes('auth') || filePath.includes('security')) return 'critical';
  if (filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts')) return 'high';
  if (filePath.includes('middleware') || filePath.includes('model')) return 'high';
  if (filePath.includes('config') || filePath.includes('types')) return 'medium';
  if (filePath.endsWith('.md') || filePath.includes('docs/')) return 'low';
  return 'medium';
}

function parseGitStatus(code: string): HandoffFileChange['status'] {
  if (code === 'A' || code === '?') return 'added';
  if (code === 'D') return 'deleted';
  if (code === 'R') return 'renamed';
  return 'modified';
}
```

### 8.3 `merge.ts` — combine partials

```typescript
// packages/core/src/builders/merge.ts

export function merge(
  partials: Partial<Handoff>[],
  metadata: { projectRoot: string; sessionId?: string; createdBy: string }
): Handoff {
  const merged = partials.reduce((acc, partial) => {
    // Merge arrays, deduplicate by path/id
    if (partial.goals) acc.goals.push(...partial.goals);
    if (partial.decisions) acc.decisions.push(...partial.decisions);
    if (partial.blockers) acc.blockers.push(...partial.blockers);
    if (partial.nextSteps) acc.nextSteps.push(...partial.nextSteps);
    if (partial.filesChanged) {
      // Deduplicate files by path — git data wins over log data
      for (const file of partial.filesChanged) {
        const existing = acc.filesChanged.findIndex(f => f.path === file.path);
        if (existing >= 0) {
          // Merge: git provides accurate line counts, logs provide write history
          acc.filesChanged[existing] = { ...acc.filesChanged[existing], ...file };
        } else {
          acc.filesChanged.push(file);
        }
      }
    }
    if (partial.context) acc.context = { ...acc.context, ...partial.context };
    if (partial.notes) acc.notes = [acc.notes, partial.notes].filter(Boolean).join('\n\n');
    return acc;
  }, createEmptyHandoff(metadata));

  // Generate stable IDs
  merged.id = `shoff_${Date.now()}_${metadata.sessionId?.slice(0, 8) || 'manual'}`;
  merged.rawTokenCount = estimateTokens(JSON.stringify(merged));
  merged.extractionConfidence = calculateConfidence(merged);
  
  return merged;
}
```

### 8.4 `budgetAllocator.ts` — token budget management

```typescript
// packages/core/src/compress/budgetAllocator.ts

// Default budgets per target tool (based on research)
export const TOOL_BUDGETS: Record<TargetTool, number> = {
  gemini:  50_000,   // 1M context, generous budget
  codex:    8_000,   // tight — Codex is token-efficient by design
  cursor:  20_000,   // ~120K effective usable, leave headroom
  claude:  15_000,   // CLAUDE.md already on disk, shortest
  chatgpt: 20_000,   // 1M context but web UI, human-readable needed
  generic: 10_000,   // conservative default
};

export interface SectionBudgets {
  goal: number;
  decisions: number;
  filesChanged: number;
  blockers: number;
  nextSteps: number;
  context: number;
  claudeMd: number;
}

export function allocateBudget(
  handoff: Handoff,
  target: TargetTool,
  overrideBudget?: number
): SectionBudgets {
  const totalBudget = overrideBudget ?? TOOL_BUDGETS[target];
  
  // Fixed allocations (always included, minimal)
  const FIXED = {
    goal:      400,
    blockers:  300,
    nextSteps: 200,
  };
  const fixedTotal = FIXED.goal + FIXED.blockers + FIXED.nextSteps;
  
  // Remaining budget for variable sections
  const remaining = totalBudget - fixedTotal;
  
  // Allocation strategy varies by target
  if (target === 'codex') {
    // Codex: files and next step most important, decisions minimal
    return {
      ...FIXED,
      decisions:    remaining * 0.15,
      filesChanged: remaining * 0.60,
      context:      remaining * 0.20,
      claudeMd:     0,               // never include CLAUDE.md for Codex
    };
  }
  
  if (target === 'claude') {
    // Claude: no CLAUDE.md (already on disk), focus on task state
    return {
      ...FIXED,
      decisions:    remaining * 0.30,
      filesChanged: remaining * 0.40,
      context:      remaining * 0.30,
      claudeMd:     0,
    };
  }
  
  if (target === 'gemini') {
    // Gemini: include everything — 1M context is generous
    const claudeMdTokens = estimateTokens(handoff.context.claudeMdContent || '');
    return {
      ...FIXED,
      decisions:    remaining * 0.20,
      filesChanged: remaining * 0.35,
      context:      remaining * 0.15,
      claudeMd:     Math.min(claudeMdTokens, remaining * 0.30),
    };
  }
  
  // Default (cursor, chatgpt, generic)
  return {
    ...FIXED,
    decisions:    remaining * 0.25,
    filesChanged: remaining * 0.40,
    context:      remaining * 0.25,
    claudeMd:     remaining * 0.10,
  };
}
```

### 8.5 `stripNoise.ts` — JSONL pre-processing

```typescript
// packages/core/src/compress/stripNoise.ts

/**
 * Strip noise from JSONL events before analysis.
 * Before: 89K tokens (full transcript)
 * After:  ~8K tokens (signal only)
 * 
 * What we keep:
 * - User messages (the prompts you typed)
 * - Assistant text responses (what Claude said)
 * - Write/Edit/MultiEdit tool_use calls (what changed)
 * - Summary events (Claude's own compact summaries)
 * 
 * What we strip:
 * - tool_result events (file reads, bash stdout, grep results)
 * - Read tool_use calls (just reading files, not changing)
 * - Bash tool_use calls (commands run, not interesting for handoff)
 * - LS, Glob, Grep tool calls (search operations)
 */
export function stripNoise(events: ClaudeLogEvent[]): ClaudeLogEvent[] {
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  const SKIP_TOOLS = new Set(['Read', 'Bash', 'LS', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoRead']);
  
  return events.filter(event => {
    // Always strip tool results
    if (event.type === 'tool_result') return false;
    
    // Keep summaries
    if (event.type === 'summary') return true;
    
    // Keep all user messages
    if (event.type === 'user') return true;
    
    // For assistant messages: keep only text content, strip tool_use blocks
    if (event.type === 'assistant') {
      const content = event.message?.content;
      if (typeof content === 'string') return true;
      if (Array.isArray(content)) {
        // Only keep if there's actual text content (not just tool calls)
        return content.some(b => b.type === 'text' && b.text?.trim());
      }
      return false;
    }
    
    // For tool_use events: only keep write operations
    if (event.type === 'tool_use') {
      const blocks = event.message?.content as ContentBlock[];
      const toolName = blocks?.find(b => b.type === 'tool_use')?.name;
      if (!toolName) return false;
      if (WRITE_TOOLS.has(toolName)) return true;
      if (SKIP_TOOLS.has(toolName)) return false;
      return false;
    }
    
    return false;
  });
}
```

---

## 9. Per-Tool Adapters — Full Spec

### 9.1 Adapter output interface

```typescript
// packages/core/src/adapters/types.ts

export interface AdapterOptions {
  tokenBudget?: number;      // override default budget
  mode?: HandoffMode;        // lean | rich | debug
  includeFullDiffs?: boolean; // include full unified diffs
}
```

### 9.2 Gemini CLI adapter

**How Gemini accepts input:** `echo "prompt" | gemini -p "instruction"` or `gemini -i "opening prompt"` for interactive session.

**What's unique:** Largest budget, receives full CLAUDE.md, gets a Google Search grounding instruction for npm packages, and we write a GEMINI.md to the project root for future sessions.

```typescript
// packages/core/src/adapters/gemini.ts

export function toGemini(handoff: Handoff, options: AdapterOptions = {}): AdapterOutput {
  const budgets = allocateBudget(handoff, 'gemini', options.tokenBudget);
  const compressed = compress(handoff, budgets);
  
  const lines: string[] = [];
  
  // Header
  lines.push(`## CONTEXT (resuming from ${handoff.sources[0]?.tool || 'AI session'})`);
  lines.push(`*Generated by Smart Handoff — ${handoff.createdAt}*`);
  lines.push('');
  
  // Goal
  lines.push('### Goal');
  for (const goal of compressed.goals) {
    lines.push(`**${goal.title}**`);
    lines.push(goal.description);
  }
  lines.push('');
  
  // Files changed (with diffs if budget allows)
  if (compressed.filesChanged.length > 0) {
    lines.push('### Files changed');
    for (const file of compressed.filesChanged) {
      lines.push(`**${file.path}** (${file.status}, ${file.importance})`);
      lines.push(`Summary: ${file.summary}`);
      if (file.diff && budgets.filesChanged > 3000) {
        lines.push('```diff');
        lines.push(file.diff.slice(0, 2000)); // cap diff length
        lines.push('```');
      }
    }
    lines.push('');
  }
  
  // Blocker
  if (compressed.blockers.length > 0) {
    lines.push('### Open blocker');
    const b = compressed.blockers[0];
    lines.push(b.description);
    if (b.errorMessage) lines.push(`Error: \`${b.errorMessage}\``);
    if (b.errorLocation) lines.push(`Location: ${b.errorLocation}`);
  }
  lines.push('');
  
  // Decisions
  if (compressed.decisions.length > 0) {
    lines.push('### Decisions made (do not re-suggest)');
    for (const d of compressed.decisions) {
      lines.push(`- ${d.summary}`);
    }
    lines.push('');
  }
  
  // Next step
  if (compressed.nextSteps.length > 0) {
    lines.push('### Next step');
    lines.push(compressed.nextSteps[0].specificAction || compressed.nextSteps[0].description);
    lines.push('');
  }
  
  // Stack
  if (compressed.context.stack.length > 0) {
    lines.push('### Stack');
    lines.push(compressed.context.stack.join(', '));
    if (compressed.context.testCommand) {
      lines.push(`Test: \`${compressed.context.testCommand}\``);
    }
    lines.push('');
  }
  
  // CLAUDE.md (Gemini budget allows it)
  if (compressed.context.claudeMdContent && budgets.claudeMd > 0) {
    lines.push('### Project instructions (CLAUDE.md)');
    lines.push(compressed.context.claudeMdContent);
    lines.push('');
  }
  
  // Search grounding instruction
  const packages = extractPackageNames(handoff);
  if (packages.length > 0) {
    lines.push(`*Note: Search for current docs on: ${packages.slice(0, 5).join(', ')}*`);
  }
  
  const text = lines.join('\n');
  
  // GEMINI.md content (persistent — stays in project for future sessions)
  const geminiMd = generateGeminiMd(handoff);
  
  return {
    text,
    deliveryMethod: 'pipe',
    targetTool: 'gemini',
    tokenCount: estimateTokens(text),
    filesToWrite: [{
      path: 'GEMINI.md',
      content: geminiMd,
      isTemporary: false,   // keep it — improves future Gemini sessions too
    }],
    launchCommand: `cat .smarthandoff/latest.md | gemini -i "You are resuming a coding task. Context is above."`,
  };
}

function generateGeminiMd(handoff: Handoff): string {
  // Generates a GEMINI.md that mirrors CLAUDE.md content
  // but adds Gemini-specific notes
  return `# Project Context
${handoff.context.claudeMdContent || ''}

# Stack
${handoff.context.stack.join('\n')}
`;
}
```

### 9.3 Codex CLI adapter

**How Codex accepts input:** `cat briefing.md | codex exec "instruction"` — prompt-plus-stdin pattern. Briefing is context, exec arg is the instruction.

**What's unique:** Tight format (8K), AGENTS.md patched temporarily with task state, exact file:line for errors, test command prominent, sandbox flag suggestion.

```typescript
// packages/core/src/adapters/codex.ts

export function toCodex(handoff: Handoff, options: AdapterOptions = {}): AdapterOutput {
  const budgets = allocateBudget(handoff, 'codex', options.tokenBudget);
  const compressed = compress(handoff, budgets);
  
  const lines: string[] = [];
  
  // Codex prefers flat, command-like format
  const goal = compressed.goals[0];
  lines.push(`TASK: ${goal?.title || 'Continue coding task'}`);
  
  // Files — exact paths, critical for Codex
  if (compressed.filesChanged.length > 0) {
    for (const file of compressed.filesChanged) {
      lines.push(`FILE: ${file.path} (${file.status})`);
    }
  }
  
  // Blocker — most prominent section for Codex
  if (compressed.blockers.length > 0) {
    const b = compressed.blockers[0];
    if (b.errorLocation) {
      lines.push(`FAILING: ${b.errorLocation}`);
      lines.push(`  Error: ${b.errorMessage || b.description}`);
    } else {
      lines.push(`BLOCKER: ${b.description}`);
    }
    if (b.suggestedNextSteps) {
      lines.push(`HYPOTHESIS: ${b.suggestedNextSteps}`);
    }
  }
  
  // Verify command
  if (compressed.context.testCommand) {
    lines.push(`VERIFY: ${compressed.context.testCommand}`);
  }
  
  // Decisions
  if (compressed.decisions.length > 0) {
    lines.push(`DECISIONS: ${compressed.decisions.map(d => d.summary).join('; ')}`);
  }
  
  // Stack (single line for Codex)
  lines.push(`STACK: ${compressed.context.stack.join(', ')}`);
  
  // Safety constraint
  const changedPaths = compressed.filesChanged.map(f => f.path.split('/').slice(0, -1).join('/')).filter(Boolean);
  const uniqueDirs = [...new Set(changedPaths)].slice(0, 3);
  if (uniqueDirs.length > 0) {
    lines.push(`SCOPE: Do not change files outside ${uniqueDirs.join(', ')}`);
  }
  
  const text = lines.join('\n');
  
  // AGENTS.md patch (temporary — active task state)
  const agentsMdPatch = `\n\n## ACTIVE TASK (from smart-handoff — delete after done)\nGoal: ${goal?.title}\n${compressed.blockers[0] ? `Blocker: ${compressed.blockers[0].description}` : ''}\n${compressed.context.testCommand ? `Verify: ${compressed.context.testCommand}` : ''}\n`;
  
  return {
    text,
    deliveryMethod: 'pipe',
    targetTool: 'codex',
    tokenCount: estimateTokens(text),
    filesToWrite: [{
      path: 'AGENTS.md',
      content: agentsMdPatch,
      isTemporary: true,    // clean up after session ends
    }],
    filesToCleanup: ['AGENTS.md'],  // the patch section, not the whole file
    launchCommand: `cat .smarthandoff/latest.md | codex exec "Fix the failing issue. Context above." --sandbox workspace-write`,
  };
}
```

### 9.4 Cursor adapter

**How Cursor accepts input:** NOT stdin. Cursor reads `.cursor/rules/*.mdc` files at session start. We write a `handoff.mdc` rule file with `alwaysApply: true`. We also generate clipboard text with `@file` references.

**What's unique:** File-write delivery, MDC format with YAML frontmatter, `@filename` syntax for auto-attachment, delete rule file when done.

```typescript
// packages/core/src/adapters/cursor.ts

export function toCursor(handoff: Handoff, options: AdapterOptions = {}): AdapterOutput {
  const budgets = allocateBudget(handoff, 'cursor', options.tokenBudget);
  const compressed = compress(handoff, budgets);
  
  // MDC rule file content
  const mdcLines: string[] = [];
  mdcLines.push('---');
  mdcLines.push('description: Active task handoff from Smart Handoff — delete this file when done');
  mdcLines.push('alwaysApply: true');
  mdcLines.push('---');
  mdcLines.push('');
  mdcLines.push('## Active task (delete .cursor/rules/handoff.mdc when done)');
  
  const goal = compressed.goals[0];
  mdcLines.push(`**Goal:** ${goal?.title || 'Continue task'}`);
  mdcLines.push('');
  
  if (compressed.blockers.length > 0) {
    mdcLines.push(`**Blocker:** ${compressed.blockers[0].description}`);
  }
  
  if (compressed.nextSteps.length > 0) {
    mdcLines.push(`**Next:** ${compressed.nextSteps[0].specificAction || compressed.nextSteps[0].description}`);
  }
  mdcLines.push('');
  
  // @file references for auto-attachment
  if (compressed.filesChanged.length > 0) {
    mdcLines.push('**Changed files (auto-attached):**');
    for (const file of compressed.filesChanged) {
      mdcLines.push(`@${file.path}`);
    }
  }
  mdcLines.push('');
  
  if (compressed.decisions.length > 0) {
    mdcLines.push('**Decisions made:**');
    for (const d of compressed.decisions) {
      mdcLines.push(`- ${d.summary}`);
    }
  }
  mdcLines.push('');
  
  if (compressed.context.stack.length > 0) {
    mdcLines.push(`**Stack:** ${compressed.context.stack.join(', ')}`);
    if (compressed.context.testCommand) {
      mdcLines.push(`**Verify:** \`${compressed.context.testCommand}\``);
    }
  }
  
  const mdcContent = mdcLines.join('\n');
  
  // Clipboard text (what user pastes in Cursor chat)
  const clipLines: string[] = [];
  clipLines.push('Continue the task. Files are already attached via rules.');
  clipLines.push('');
  // @file references in clipboard too
  for (const file of compressed.filesChanged) {
    clipLines.push(`@${file.path}`);
  }
  clipLines.push('');
  clipLines.push(compressed.nextSteps[0]?.specificAction || `Fix: ${compressed.blockers[0]?.description || 'continue task'}`);
  if (compressed.context.testCommand) {
    clipLines.push(`Verify with: \`${compressed.context.testCommand}\``);
  }
  
  const clipText = clipLines.join('\n');
  
  return {
    text: clipText,
    deliveryMethod: 'file-write',
    targetTool: 'cursor',
    tokenCount: estimateTokens(mdcContent),
    filesToWrite: [{
      path: '.cursor/rules/handoff.mdc',
      content: mdcContent,
      isTemporary: true,
    }],
    filesToCleanup: ['.cursor/rules/handoff.mdc'],
  };
}
```

### 9.5 Claude adapter (resume)

**What's unique:** Shortest briefing (CLAUDE.md already on disk), reads Claude auto-memory from `~/.claude/projects/.../memory/`, mirrors Claude's own /compact output format.

```typescript
// packages/core/src/adapters/claude.ts

export function toClaude(handoff: Handoff, options: AdapterOptions = {}): AdapterOutput {
  const budgets = allocateBudget(handoff, 'claude', options.tokenBudget);
  const compressed = compress(handoff, budgets);
  
  const lines: string[] = [];
  
  lines.push(`## Session resume — ${handoff.createdAt}`);
  lines.push('*(Previous session ended: rate limit)*');
  lines.push('');
  
  const goal = compressed.goals[0];
  lines.push(`**Task:** ${goal?.title}`);
  lines.push(`**Status:** ${compressed.filesChanged.length} files done, ${compressed.blockers.length > 0 ? '1 test failing' : 'no blockers'}`);
  lines.push('');
  
  if (compressed.filesChanged.length > 0) {
    lines.push('**Done:**');
    for (const file of compressed.filesChanged) {
      const icon = file.status === 'added' ? '(new)' : '✓';
      lines.push(`- ${file.path} ${icon}`);
    }
    lines.push('');
  }
  
  if (compressed.blockers.length > 0) {
    const b = compressed.blockers[0];
    lines.push(`**Blocked on:**`);
    lines.push(b.description);
    if (b.errorMessage) lines.push(`\`${b.errorMessage}\``);
    lines.push('');
  }
  
  if (compressed.decisions.length > 0) {
    lines.push('**Decisions (do not re-suggest):**');
    for (const d of compressed.decisions) {
      lines.push(`- ${d.summary}`);
    }
    lines.push('');
  }
  
  // Include auto-memory fragments if available
  if (handoff.notes) {
    lines.push('**Memory fragments relevant to this task:**');
    lines.push(handoff.notes);
    lines.push('');
  }
  
  if (compressed.nextSteps.length > 0) {
    lines.push(`**Next:** ${compressed.nextSteps[0].specificAction || compressed.nextSteps[0].description}`);
    if (compressed.context.testCommand) {
      lines.push(`Run: \`${compressed.context.testCommand}\``);
    }
  }
  
  lines.push('');
  lines.push('*(CLAUDE.md is already on disk — context loaded automatically.)*');
  
  const text = lines.join('\n');
  
  return {
    text,
    deliveryMethod: 'clipboard',
    targetTool: 'claude',
    tokenCount: estimateTokens(text),
    launchCommand: 'claude  # paste the briefing as your first message',
  };
}
```

### 9.6 ChatGPT adapter

**What's unique:** Two outputs (system prompt + first message), human-readable formatting, includes CLAUDE.md since no equivalent on disk.

```typescript
// packages/core/src/adapters/chatgpt.ts

export function toChatGPT(handoff: Handoff, options: AdapterOptions = {}): AdapterOutput {
  const budgets = allocateBudget(handoff, 'chatgpt', options.tokenBudget);
  const compressed = compress(handoff, budgets);
  
  // PART 1: System prompt
  const systemLines: string[] = [];
  systemLines.push('You are a senior software engineer continuing work from an AI coding session.');
  if (compressed.context.stack.length > 0) {
    systemLines.push(`Stack: ${compressed.context.stack.join(', ')}.`);
  }
  systemLines.push('Follow existing patterns. Do not refactor what is already working. Ask clarifying questions only if essential.');
  const systemPrompt = systemLines.join(' ');
  
  // PART 2: First message
  const msgLines: string[] = [];
  msgLines.push("I'm continuing a coding session. Rate limit hit on Claude, switching to you.");
  msgLines.push('');
  
  const goal = compressed.goals[0];
  msgLines.push(`**What we were building:** ${goal?.description || goal?.title}`);
  msgLines.push('');
  
  if (compressed.filesChanged.length > 0) {
    msgLines.push('**Files already changed:**');
    for (const file of compressed.filesChanged) {
      msgLines.push(`- \`${file.path}\` — ${file.summary || file.status}`);
    }
    msgLines.push('');
  }
  
  if (compressed.blockers.length > 0) {
    const b = compressed.blockers[0];
    msgLines.push('**Current blocker:**');
    if (b.errorLocation) {
      msgLines.push(`${b.errorLocation} fails:`);
    }
    msgLines.push(b.description);
    if (b.errorMessage) msgLines.push(`\`\`\`\n${b.errorMessage}\n\`\`\``);
    msgLines.push('');
  }
  
  if (compressed.decisions.length > 0) {
    msgLines.push('**Decisions already made — do not re-suggest:**');
    for (const d of compressed.decisions) {
      msgLines.push(`- ${d.summary}`);
    }
    msgLines.push('');
  }
  
  if (compressed.nextSteps.length > 0) {
    msgLines.push(`**Please:** ${compressed.nextSteps[0].specificAction || compressed.nextSteps[0].description}`);
  }
  
  const messageText = msgLines.join('\n');
  const combinedText = `SYSTEM PROMPT:\n${systemPrompt}\n\n---\n\nFIRST MESSAGE:\n${messageText}`;
  
  return {
    text: messageText,
    systemPrompt,
    deliveryMethod: 'two-part-clipboard',
    targetTool: 'chatgpt',
    tokenCount: estimateTokens(combinedText),
  };
}
```

---

## 10. CLI — Every Command

### Entry point setup

```typescript
// apps/cli/src/index.ts

import { program } from 'commander';
import { initCommand } from './commands/init.js';
import { snapshotCommand } from './commands/snapshot.js';
import { resumeCommand } from './commands/resume.js';
import { routeCommand } from './commands/route.js';
import { analyzeCommand } from './commands/analyze.js';
import { listCommand } from './commands/list.js';

program
  .name('smarthandoff')
  .alias('shoff')
  .description('Smart Handoff — zero-friction AI session continuity')
  .version('1.0.0');

program.addCommand(initCommand);
program.addCommand(snapshotCommand);
program.addCommand(resumeCommand);
program.addCommand(routeCommand);
program.addCommand(analyzeCommand);
program.addCommand(listCommand);

program.parse();
```

### Command: `smarthandoff init`

**What it does:**
1. Creates `.smarthandoff/config.yaml` in the project root
2. Reads `~/.claude/settings.json` and adds PreCompact + StopFailure hooks
3. Detects available tools (gemini, codex, cursor) and sets default target
4. Creates `.smarthandoff/` directory structure

```typescript
// apps/cli/src/commands/init.ts

export const initCommand = new Command('init')
  .description('Initialize Smart Handoff in this project')
  .option('--target <tool>', 'default target tool (gemini|codex|cursor|claude|chatgpt)')
  .option('--no-hooks', 'skip Claude Code hooks registration')
  .action(async (options) => {
    
    console.log('Initializing Smart Handoff...\n');
    
    // 1. Create directory structure
    await fs.mkdir('.smarthandoff/handoffs', { recursive: true });
    await fs.mkdir('.smarthandoff/cache', { recursive: true });
    
    // 2. Detect installed tools
    const detected = await detectTools();
    const defaultTarget = options.target || detected[0] || 'generic';
    
    console.log('Detected tools:');
    for (const tool of ['gemini', 'codex', 'cursor', 'claude']) {
      const found = detected.includes(tool);
      console.log(`  ${found ? '✓' : '✗'} ${tool}`);
    }
    
    // 3. Write config
    const config = {
      projectId: path.basename(process.cwd()),
      defaultTarget,
      collectors: {
        claudeLogs: { enabled: true },
        git: { enabled: true, includeDiffs: false },
        memory: { enabled: true },
      },
      compression: {
        defaultMode: 'rich',
        profiles: {
          lean: { budget: 4000 },
          rich: { budget: null },  // null = use tool default
          debug: { budget: 100000 },
        },
      },
      policy: {
        autoSnapshotOnRateLimit: true,
        autoSnapshotOnPreCompact: true,
        minFilesChanged: 1,
      },
    };
    
    await writeYaml('.smarthandoff/config.yaml', config);
    console.log('\n✓ Created .smarthandoff/config.yaml');
    
    // 4. Register Claude Code hooks
    if (options.hooks !== false) {
      await registerClaudeHooks(defaultTarget);
      console.log('✓ Registered Claude Code hooks:');
      console.log('    PreCompact → auto-snapshot when context fills');
      console.log('    StopFailure[rate_limit] → auto-route when rate limited');
    }
    
    // 5. Add .smarthandoff/cache to .gitignore, but not handoffs/
    await appendToGitignore(['.smarthandoff/cache/', '.smarthandoff/events.jsonl']);
    
    console.log('\n✅ Smart Handoff initialized!');
    console.log('   Run: smarthandoff route --to <tool>  when you need to switch');
    console.log('   Or just hit your rate limit — it auto-fires 🚀');
  });

async function registerClaudeHooks(defaultTarget: string) {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  
  // Read existing settings
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch { /* file doesn't exist yet */ }
  
  // Add hooks
  const hooks = (settings.hooks as Record<string, unknown[]>) || {};
  
  // PreCompact hook — fires when context window fills
  hooks.PreCompact = [
    ...(hooks.PreCompact || []),
    {
      matcher: 'auto',
      hooks: [{
        type: 'command',
        command: `smarthandoff snapshot --mode lean --source precompact`,
        async: true,   // don't block Claude
        timeout: 30,
      }],
    },
  ];
  
  // StopFailure hook — fires on rate limit
  hooks.StopFailure = [
    ...(hooks.StopFailure || []),
    {
      matcher: 'rate_limit',
      hooks: [{
        type: 'command',
        command: `smarthandoff route --to ${defaultTarget} --trigger rate_limit`,
        timeout: 60,
      }],
    },
  ];
  
  settings.hooks = hooks;
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}
```

### Command: `smarthandoff snapshot`

```typescript
// apps/cli/src/commands/snapshot.ts

export const snapshotCommand = new Command('snapshot')
  .description('Create a handoff from current session state')
  .option('--mode <mode>', 'lean | rich | debug', 'rich')
  .option('--session-id <id>', 'specific Claude session ID (default: most recent)')
  .option('--budget <tokens>', 'override token budget', parseInt)
  .option('--note <text>', 'add a manual note to the handoff')
  .option('--source <source>', 'trigger source (manual|precompact|stop)', 'manual')
  .option('--print', 'print handoff summary to stdout')
  .action(async (options) => {
    
    const config = await loadConfig();
    const spinner = createSpinner('Building handoff...');
    
    // 1. Find session transcript
    const transcriptPath = options.sessionId
      ? await findTranscript(options.sessionId)
      : await findLatestTranscript();
    
    spinner.update('Parsing session...');
    
    // 2. Build from all sources
    const partials: Partial<Handoff>[] = [];
    
    if (config.collectors.claudeLogs.enabled && transcriptPath) {
      const logPartial = await fromClaudeLogs(transcriptPath);
      partials.push(logPartial);
    }
    
    if (config.collectors.git.enabled) {
      const gitPartial = await fromGit(process.cwd(), {
        includeDiffs: options.mode === 'rich' || options.mode === 'debug',
      });
      partials.push(gitPartial);
    }
    
    if (config.collectors.memory.enabled) {
      const memPartial = await fromMemory(process.cwd(), transcriptPath);
      partials.push(memPartial);
    }
    
    if (options.note) {
      partials.push({ notes: options.note });
    }
    
    // 3. Also load CLAUDE.md
    const claudeMd = await loadClaudeMd(process.cwd());
    if (claudeMd) {
      partials.push({ context: { claudeMdContent: claudeMd, stack: [] } });
    }
    
    spinner.update('Merging sources...');
    
    // 4. Merge into complete Handoff
    const handoff = merge(partials, {
      projectRoot: process.cwd(),
      sessionId: options.sessionId,
      createdBy: `${os.userInfo().username}@${os.hostname()}`,
    });
    
    // 5. Save
    const savePath = `.smarthandoff/handoffs/${handoff.id}.json`;
    await fs.writeFile(savePath, JSON.stringify(handoff, null, 2));
    
    // Always save a latest.json symlink
    await saveLatest(handoff);
    
    spinner.succeed(`Handoff created: ${handoff.id}`);
    
    // Print summary
    console.log(`\n  Goals:    ${handoff.goals.length}`);
    console.log(`  Decisions: ${handoff.decisions.length}`);
    console.log(`  Files:     ${handoff.filesChanged.length}`);
    console.log(`  Blockers:  ${handoff.blockers.length}`);
    console.log(`  Tokens:    ~${handoff.rawTokenCount.toLocaleString()} raw`);
    
    if (options.print) {
      console.log('\n--- HANDOFF SUMMARY ---');
      printHandoffSummary(handoff);
    }
    
    // Emit analytics event
    await emitEvent({ type: 'HANDOFF_CREATED', handoffId: handoff.id });
    
    return handoff;
  });
```

### Command: `smarthandoff route`

This is the primary command. Does everything in one shot.

```typescript
// apps/cli/src/commands/route.ts

export const routeCommand = new Command('route')
  .description('Snapshot current session and deliver to target tool (one command)')
  .option('--to <tool>', 'target tool: gemini | codex | cursor | claude | chatgpt | generic')
  .option('--auto', 'auto-detect best available tool')
  .option('--from <tool>', 'source tool (default: auto-detect from latest session)')
  .option('--mode <mode>', 'lean | rich', 'rich')
  .option('--budget <tokens>', 'override token budget', parseInt)
  .option('--include-diffs', 'include full file diffs')
  .option('--preview', 'preview briefing without delivering')
  .option('--trigger <trigger>', 'trigger source (manual|rate_limit|precompact)', 'manual')
  .option('--session-id <id>', 'specific session to route from')
  .action(async (options) => {
    
    // 1. Determine target tool
    let target: TargetTool;
    if (options.auto || !options.to) {
      target = await autoDetectTarget();
      console.log(`Auto-selected: ${target}`);
    } else {
      target = options.to as TargetTool;
    }
    
    // 2. Build snapshot (calls snapshot internals)
    console.log(`\nBuilding handoff for ${target}...`);
    const handoff = await buildHandoff({
      sessionId: options.sessionId,
      mode: options.mode,
      includeDiffs: options.includeDiffs,
    });
    
    // 3. Generate adapter output
    const adapterFn = getAdapter(target);
    const output = adapterFn(handoff, {
      tokenBudget: options.budget,
      mode: options.mode,
      includeFullDiffs: options.includeDiffs,
    });
    
    console.log(`\n  Token count: ${output.tokenCount.toLocaleString()} / ${TOOL_BUDGETS[target].toLocaleString()}`);
    console.log(`  Delivery:    ${output.deliveryMethod}`);
    
    if (options.preview) {
      console.log('\n--- BRIEFING PREVIEW ---');
      console.log(output.text);
      console.log('--- END PREVIEW ---');
      console.log('\nRun without --preview to deliver.');
      return;
    }
    
    // 4. Write any files needed
    if (output.filesToWrite) {
      for (const file of output.filesToWrite) {
        await fs.mkdir(path.dirname(file.path), { recursive: true });
        // For AGENTS.md: append task section, don't overwrite
        if (file.path === 'AGENTS.md' && await exists('AGENTS.md')) {
          await fs.appendFile(file.path, file.content);
        } else {
          await fs.writeFile(file.path, file.content);
        }
        const tempNote = file.isTemporary ? ' (temporary — delete after session)' : '';
        console.log(`  ✓ Written: ${file.path}${tempNote}`);
      }
    }
    
    // Save briefing to latest.md
    await fs.writeFile('.smarthandoff/latest.md', output.text);
    
    // 5. Deliver
    await deliver(output);
    
    // 6. Print launch command
    if (output.launchCommand) {
      console.log('\n🚀 Run this to start:');
      console.log(`   ${output.launchCommand}`);
    }
    
    // 7. Analytics
    await emitEvent({
      type: 'HANDOFF_USED',
      handoffId: handoff.id,
      targetTool: target,
      trigger: options.trigger,
    });
  });

async function autoDetectTarget(): Promise<TargetTool> {
  const detected = await detectTools();
  
  console.log('Detecting available tools...');
  const candidates = ['gemini', 'codex', 'cursor'] as TargetTool[];
  
  for (const tool of candidates) {
    const found = detected.includes(tool);
    console.log(`  ${found ? '✓' : '✗'} ${tool}`);
  }
  
  // Preference order: gemini (free, 1M), codex, generic
  return detected[0] as TargetTool || 'generic';
}
```

### Command: `smarthandoff resume`

For when you already have a saved handoff and want to generate the briefing for a specific target.

```typescript
export const resumeCommand = new Command('resume')
  .description('Generate target-tool prompt from a saved handoff')
  .option('--id <handoffId>', 'handoff ID (default: most recent)')
  .option('--to <tool>', 'target tool', 'claude')
  .option('--mode <mode>', 'lean | rich', 'rich')
  .option('--budget <tokens>', 'override token budget', parseInt)
  .option('--copy', 'copy to clipboard')
  .option('--print', 'print to stdout')
  .action(async (options) => {
    
    const handoff = options.id
      ? await loadHandoff(options.id)
      : await loadLatestHandoff();
    
    if (!handoff) {
      console.error('No handoff found. Run: smarthandoff snapshot first.');
      process.exit(1);
    }
    
    const target = options.to as TargetTool;
    const adapterFn = getAdapter(target);
    const output = adapterFn(handoff, {
      tokenBudget: options.budget,
      mode: options.mode,
    });
    
    await deliver(output, { forceClipboard: options.copy, forcePrint: options.print });
    
    if (output.launchCommand) {
      console.log(`\nRun: ${output.launchCommand}`);
    }
  });
```

### Command: `smarthandoff analyze`

```typescript
export const analyzeCommand = new Command('analyze')
  .description('Inspect a handoff — what was extracted, token allocation, confidence')
  .option('--id <handoffId>', 'handoff ID (default: most recent)')
  .option('--target <tool>', 'show allocation for specific target', 'gemini')
  .option('--verbose', 'show full content of each section')
  .action(async (options) => {
    
    const handoff = options.id
      ? await loadHandoff(options.id)
      : await loadLatestHandoff();
    
    if (!handoff) {
      console.error('No handoff found.');
      process.exit(1);
    }
    
    const target = options.target as TargetTool;
    const budgets = allocateBudget(handoff, target);
    
    console.log(`\nHANDOFF ANALYSIS: ${handoff.id}`);
    console.log(`Created: ${handoff.createdAt} | Source: ${handoff.sources[0]?.tool}`);
    
    console.log('\nEXTRACTION SOURCES');
    for (const source of handoff.sources) {
      console.log(`  ├── ${source.tool}: session ${source.sessionId?.slice(0, 8)}`);
    }
    console.log(`  └── Raw token count: ~${handoff.rawTokenCount.toLocaleString()}`);
    
    console.log(`\nTOKEN ALLOCATION (target: ${target}, budget: ${TOOL_BUDGETS[target].toLocaleString()})`);
    const sections = [
      { name: 'Goal', budget: budgets.goal, count: handoff.goals.length, unit: 'goals' },
      { name: 'Decisions', budget: budgets.decisions, count: handoff.decisions.length, unit: 'decisions' },
      { name: 'Files', budget: budgets.filesChanged, count: handoff.filesChanged.length, unit: 'files' },
      { name: 'Blockers', budget: budgets.blockers, count: handoff.blockers.length, unit: 'blockers' },
      { name: 'Next steps', budget: budgets.nextSteps, count: handoff.nextSteps.length, unit: 'steps' },
      { name: 'CLAUDE.md', budget: budgets.claudeMd, count: !!handoff.context.claudeMdContent ? 1 : 0, unit: 'files' },
    ];
    
    for (const s of sections) {
      const bar = '█'.repeat(Math.floor(s.budget / 500)).padEnd(20, '░');
      console.log(`  ${s.name.padEnd(12)} ${bar} ~${Math.floor(s.budget).toLocaleString()} tokens  (${s.count} ${s.unit})`);
    }
    
    console.log('\nCONFIDENCE SCORES');
    console.log(`  Overall:     ${(handoff.extractionConfidence * 100).toFixed(0)}%`);
    for (const d of handoff.decisions) {
      console.log(`  Decision:    ${(d.confidence * 100).toFixed(0)}%  "${d.summary.slice(0, 60)}..."`);
    }
    
    if (options.verbose) {
      console.log('\nFULL CONTENT');
      console.log(JSON.stringify(handoff, null, 2));
    }
  });
```

### Command: `smarthandoff list`

```typescript
export const listCommand = new Command('list')
  .description('List all saved handoffs for this project')
  .option('--limit <n>', 'number of handoffs to show', '10')
  .action(async (options) => {
    
    const handoffs = await loadAllHandoffs();
    const recent = handoffs
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, parseInt(options.limit));
    
    console.log(`\nSMART HANDOFFS — ${process.cwd()}\n`);
    
    for (const h of recent) {
      const age = getRelativeTime(h.createdAt);
      console.log(`  ${h.id.slice(0, 20)}  ${age.padEnd(12)}  ${h.goals[0]?.title?.slice(0, 50) || 'No goal'}`);
    }
    
    console.log(`\nTotal: ${handoffs.length} handoffs`);
    console.log('Run: smarthandoff resume --id <id> --to <tool>');
  });
```

### Delivery module

```typescript
// apps/cli/src/deliver/index.ts

export async function deliver(
  output: AdapterOutput,
  opts: { forceClipboard?: boolean; forcePrint?: boolean } = {}
): Promise<void> {
  
  if (opts.forcePrint) {
    process.stdout.write(output.text);
    return;
  }
  
  switch (output.deliveryMethod) {
    
    case 'pipe':
      // Write to stdout so user can pipe: smarthandoff route --to gemini | gemini -i "resume"
      // Also save to .smarthandoff/latest.md
      process.stdout.write(output.text);
      break;
    
    case 'clipboard':
    case 'file-write':
      // Copy to clipboard
      await copyToClipboard(output.text);
      console.log(`✓ Briefing copied to clipboard (${output.tokenCount.toLocaleString()} tokens)`);
      break;
    
    case 'two-part-clipboard':
      // Copy first message; print instructions for system prompt
      await copyToClipboard(output.text);
      console.log('\n📋 TWO-PART CLIPBOARD — ChatGPT needs two pastes:');
      console.log('\n1. SYSTEM PROMPT (paste in the system field):');
      console.log('─'.repeat(50));
      console.log(output.systemPrompt);
      console.log('─'.repeat(50));
      console.log('\n2. FIRST MESSAGE: Already copied to clipboard. Paste with Cmd+V.');
      break;
  }
}

async function copyToClipboard(text: string): Promise<void> {
  // Cross-platform clipboard
  const { default: clipboardy } = await import('clipboardy');
  await clipboardy.write(text);
}
```

### Tool detection

```typescript
// apps/cli/src/detect/toolDetector.ts

import { execSync } from 'node:child_process';

const TOOL_COMMANDS: Record<string, string> = {
  gemini: 'gemini --version',
  codex:  'codex --version',
  cursor: 'cursor --version',
  claude: 'claude --version',
};

export async function detectTools(): Promise<string[]> {
  const available: string[] = [];
  
  for (const [tool, cmd] of Object.entries(TOOL_COMMANDS)) {
    try {
      execSync(cmd, { stdio: 'ignore' });
      available.push(tool);
    } catch { /* not installed */ }
  }
  
  return available;
}
```

---

## 11. Claude Code Plugin

The Claude Code plugin ships as a `smart-handoff` plugin installable from the Claude Code marketplace. It adds:

1. A `/handoff` slash command skill
2. Pre-registered hooks (StopFailure + PreCompact)
3. A background monitor that tracks context usage

### Plugin structure

```
plugins/claude-code/
├── package.json
└── src/
    ├── manifest.json        ← Claude Code plugin manifest
    ├── skills/
    │   └── handoff.md       ← /handoff slash command
    ├── hooks/
    │   ├── stopFailure.sh   ← rate limit auto-trigger
    │   └── preCompact.sh    ← context window trigger
    └── monitors/
        └── contextMonitor.sh  ← background usage watcher
```

### Plugin manifest

```json
{
  "name": "smart-handoff",
  "version": "1.0.0",
  "description": "Zero-friction AI session continuity. Switch tools without losing context.",
  "skills": ["src/skills/handoff.md"],
  "hooks": {
    "StopFailure": {
      "matcher": "rate_limit",
      "command": "node src/hooks/stopFailure.js"
    },
    "PreCompact": {
      "matcher": "auto",
      "command": "node src/hooks/preCompact.js",
      "async": true
    }
  },
  "monitors": ["src/monitors/contextMonitor.js"]
}
```

### `/handoff` skill

```markdown
---
name: handoff
description: Generate a Smart Handoff briefing to continue this session in another AI tool.
  Use when approaching rate limits, context window limits, or wanting to switch tools.
  Supports: gemini, codex, cursor, claude, chatgpt
user_invocable: true
args: "[--to <tool>] [--mode lean|rich] [--preview]"
---

Generate a Smart Handoff briefing for continuing this session.

**Step 1: Read the current conversation**
Scan this entire session for:
- The original user goal (first substantial message)
- All files written or edited (look at Write/Edit tool calls)
- The current blocker or unresolved issue (last user message + error)
- Key decisions made (look for "decided", "choosing", "not using", "rejected")
- The specific next action needed

**Step 2: Extract project context**
- Read CLAUDE.md if present
- Read package.json for stack info
- Note the test command if mentioned

**Step 3: Format for target tool**

Target: {{ARGUMENTS}} (default: gemini if not specified)

Format rules:
- **gemini**: generous format, include full CLAUDE.md, add search grounding note for npm packages
- **codex**: tight format (under 8K tokens), exact file:line for errors, test command prominent
- **cursor**: @filename references for changed files, clean markdown, no pipe commands  
- **claude**: shortest format, omit CLAUDE.md (already on disk), include memory fragments
- **chatgpt**: two sections labeled "SYSTEM PROMPT:" and "FIRST MESSAGE:", human-readable

**Step 4: Output**

Print the briefing in a code block, then print:
```
Saved to: .smarthandoff/latest.md
Run: [the exact command to launch the target tool with this briefing]
```

Also write the briefing to `.smarthandoff/latest.md`.

Keep the briefing under 15K tokens total regardless of target.
```

### StopFailure hook

```bash
#!/bin/bash
# plugins/claude-code/src/hooks/stopFailure.sh
# Fires when Claude Code hits a rate limit

INPUT=$(cat)
ERROR=$(echo "$INPUT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(d.error||'')")

if [ "$ERROR" = "rate_limit" ]; then
  echo "⚡ Rate limit hit — generating Smart Handoff..." >&2
  
  # Check if smarthandoff CLI is available
  if command -v smarthandoff &> /dev/null; then
    smarthandoff route --auto --trigger rate_limit --mode lean
  else
    # Fallback: basic extraction without the CLI
    TRANSCRIPT=$(echo "$INPUT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(d.transcript_path||'')")
    if [ -n "$TRANSCRIPT" ]; then
      # Extract last user message as blocker
      LAST_USER=$(node -e "
        const fs = require('fs');
        const lines = fs.readFileSync('$TRANSCRIPT', 'utf8').trim().split('\n');
        const userMsgs = lines.map(l => JSON.parse(l)).filter(e => e.type === 'user');
        const last = userMsgs[userMsgs.length - 1];
        const content = last?.message?.content;
        process.stdout.write(typeof content === 'string' ? content : JSON.stringify(content));
      ")
      echo "Last context: $LAST_USER" | pbcopy
      echo "✓ Last message copied to clipboard" >&2
    fi
  fi
fi

# StopFailure hooks have no decision control — always exit 0
exit 0
```

### PreCompact hook

```bash
#!/bin/bash
# plugins/claude-code/src/hooks/preCompact.sh
# Fires when context window is filling up — runs async

INPUT=$(cat)

if command -v smarthandoff &> /dev/null; then
  # Run async — don't block compaction
  smarthandoff snapshot --mode lean --source precompact &
  echo "Smart Handoff: background snapshot started" >&2
fi

# Never block compaction
exit 0
```

---

## 12. Policy Engine — Smart Triggers

The policy engine decides when to auto-create handoffs.

```typescript
// packages/core/src/policy/evaluator.ts

export interface PolicyConfig {
  autoSnapshotOnRateLimit: boolean;      // via StopFailure hook
  autoSnapshotOnPreCompact: boolean;     // via PreCompact hook  
  autoSnapshotOnSessionEnd: boolean;     // via SessionEnd hook (optional)
  minFilesChanged: number;               // minimum to trigger auto-snapshot
  minMessages: number;                   // minimum session length
}

export interface SessionMetrics {
  messageCount: number;
  filesChanged: number;
  hasBlocker: boolean;
  trigger: 'rate_limit' | 'precompact' | 'session_end' | 'manual';
}

export type PolicyDecision = {
  action: 'none' | 'suggest' | 'auto';
  mode: HandoffMode;
  reason: string;
};

export function evaluatePolicy(
  config: PolicyConfig,
  metrics: SessionMetrics
): PolicyDecision {
  
  // Rate limit — always auto, lean mode (need it NOW)
  if (metrics.trigger === 'rate_limit' && config.autoSnapshotOnRateLimit) {
    return {
      action: 'auto',
      mode: 'lean',
      reason: 'Rate limit hit — lean handoff for immediate resumption',
    };
  }
  
  // PreCompact — auto if meaningful session, rich mode (proactive)
  if (metrics.trigger === 'precompact' && config.autoSnapshotOnPreCompact) {
    if (metrics.filesChanged >= config.minFilesChanged || metrics.messageCount >= config.minMessages) {
      return {
        action: 'auto',
        mode: 'rich',
        reason: `Context filling — rich snapshot (${metrics.filesChanged} files, ${metrics.messageCount} messages)`,
      };
    }
    return { action: 'none', mode: 'lean', reason: 'Session too short for auto-snapshot' };
  }
  
  // Session end — suggest if meaningful
  if (metrics.trigger === 'session_end' && config.autoSnapshotOnSessionEnd) {
    if (metrics.filesChanged >= config.minFilesChanged) {
      return {
        action: 'suggest',
        mode: 'rich',
        reason: `Session ended with ${metrics.filesChanged} changed files`,
      };
    }
  }
  
  return { action: 'none', mode: 'lean', reason: 'No policy triggered' };
}
```

---

## 13. Analytics

Analytics are local-first. Events written to `.smarthandoff/events.jsonl`.

```typescript
// packages/core/src/analytics/events.ts

export type EventType =
  | 'HANDOFF_CREATED'
  | 'HANDOFF_USED'
  | 'ROUTE_TRIGGERED'
  | 'SNAPSHOT_TRIGGERED'
  | 'TOOL_DETECTED';

export interface HandoffEvent {
  type: EventType;
  timestamp: string;
  projectId?: string;
  handoffId?: string;
  targetTool?: string;
  trigger?: string;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

// packages/core/src/analytics/writer.ts
export async function emitEvent(event: Omit<HandoffEvent, 'timestamp'>): Promise<void> {
  const fullEvent: HandoffEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  
  const eventsPath = path.join(process.cwd(), '.smarthandoff', 'events.jsonl');
  await fs.appendFile(eventsPath, JSON.stringify(fullEvent) + '\n', 'utf8');
}
```

---

## 14. Monorepo Setup — Step by Step

### Step 1: Initialize monorepo

```bash
mkdir smart-handoff && cd smart-handoff
git init

# Root package.json
cat > package.json << 'EOF'
{
  "name": "smart-handoff",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "publish-packages": "turbo run build lint test && changeset version && changeset publish"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "@changesets/cli": "^2.27.0",
    "typescript": "^5.4.0"
  }
}
EOF

# pnpm workspace config
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'packages/*'
  - 'apps/*'
  - 'plugins/*'
EOF

# Turborepo config
cat > turbo.json << 'EOF'
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"]
    },
    "lint": {}
  }
}
EOF

# Root tsconfig
cat > tsconfig.base.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  }
}
EOF
```

### Step 2: Create `@smarthandoff/core` package

```bash
mkdir -p packages/core/src/{builders,compress,adapters,policy,analytics}

cat > packages/core/package.json << 'EOF'
{
  "name": "@smarthandoff/core",
  "version": "0.1.0",
  "description": "Smart Handoff core library — handoff schema, builders, compression, adapters",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./types": {
      "types": "./dist/types.d.ts",
      "import": "./dist/types.js"
    },
    "./adapters": {
      "types": "./dist/adapters/index.d.ts",
      "import": "./dist/adapters/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "dev": "tsup src/index.ts --format esm --dts --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "vitest": "^1.6.0",
    "typescript": "^5.4.0"
  }
}
EOF

cat > packages/core/tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
EOF
```

### Step 3: Create CLI app

```bash
mkdir -p apps/cli/src/{commands,deliver,detect,hooks}

cat > apps/cli/package.json << 'EOF'
{
  "name": "@smarthandoff/cli",
  "version": "0.1.0",
  "description": "Smart Handoff CLI — smarthandoff command",
  "type": "module",
  "bin": {
    "smarthandoff": "./dist/index.js",
    "shoff": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --clean",
    "dev": "tsup src/index.ts --format esm --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@smarthandoff/core": "workspace:*",
    "commander": "^12.0.0",
    "clipboardy": "^4.0.0",
    "js-yaml": "^4.1.0",
    "ora": "^8.0.0",
    "chalk": "^5.3.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "vitest": "^1.6.0",
    "typescript": "^5.4.0"
  }
}
EOF
```

### Step 4: Install dependencies

```bash
pnpm install
```

### Step 5: Initialize Changesets

```bash
pnpm changeset init
```

### Step 6: Set up test fixtures

```bash
mkdir -p packages/core/src/__tests__/fixtures

# Add real sample JSONL for testing
# (copy a real Claude Code session transcript for unit tests)
cp ~/.claude/projects/*/$(ls ~/.claude/projects/*/ | head -1) \
   packages/core/src/__tests__/fixtures/sample-session.jsonl
```

---

## 15. Implementation Milestones

### Milestone 1 — Core parser + Claude→Claude (Week 1–2)

**Goal:** Something that works end-to-end for the simplest case.

**Tasks:**

```
[ ] Set up monorepo (pnpm + turbo + changesets)
[ ] Implement types.ts — full Handoff schema
[ ] Implement stripNoise.ts — JSONL event filter
[ ] Implement fromClaudeLogs.ts — basic parser (goal + files + blocker)
[ ] Implement fromGit.ts — git status + diff stats
[ ] Implement merge.ts — combine partials
[ ] Implement budgetAllocator.ts — token budgets (hardcoded defaults)
[ ] Implement claude.ts adapter — shortest, no CLAUDE.md needed
[ ] Implement generic.ts adapter — universal markdown
[ ] Implement deliver/clipboard.ts
[ ] CLI: init command (config only, no hooks yet)
[ ] CLI: snapshot command
[ ] CLI: resume command (--to claude)
[ ] Unit tests: JSONL parsing with fixture
[ ] Unit tests: git builder with mock git output
[ ] Unit tests: Claude adapter output
[ ] npm publish @smarthandoff/core@0.1.0 (alpha)
[ ] npm publish @smarthandoff/cli@0.1.0 (alpha)
[ ] Test on real session: does resume work?
```

**Definition of done:** `smarthandoff snapshot && smarthandoff resume --to claude --copy` works on a real Claude Code project.

### Milestone 2 — Gemini + Codex + route command (Week 3–4)

**Goal:** The primary use case — rate limit → route → different tool.

**Tasks:**

```
[ ] Implement fromMemory.ts — Claude auto-memory reader
[ ] Implement gemini.ts adapter (stdin pipe, GEMINI.md write)
[ ] Implement codex.ts adapter (AGENTS.md patch, tight format)
[ ] Implement deliver/pipe.ts (stdout for piping)
[ ] Implement deliver/fileWrite.ts (for Cursor, AGENTS.md)
[ ] Implement toolDetector.ts (which tools are in PATH)
[ ] CLI: route command (full end-to-end)
[ ] CLI: --auto flag in route
[ ] Register StopFailure hook in init command
[ ] Register PreCompact hook in init command
[ ] Integration test: Claude → Gemini route on real session
[ ] Integration test: Claude → Codex route on real session
[ ] Update README with examples
[ ] npm publish 0.2.0
```

**Definition of done:** Hit Claude rate limit → handoff auto-generates → Gemini CLI opens with full context. Zero user input required after hitting rate limit.

### Milestone 3 — Cursor + ChatGPT + analyze command (Week 5–6)

**Goal:** Complete the adapter set. Add observability.

**Tasks:**

```
[ ] Implement cursor.ts adapter (MDC file-write, @file references)
[ ] Implement chatgpt.ts adapter (two-part clipboard)
[ ] Implement deliver/twoPartClipboard.ts
[ ] CLI: analyze command (full token allocation visualization)
[ ] CLI: list command
[ ] Policy engine implementation
[ ] Analytics: event emission + events.jsonl
[ ] compressDiffs.ts (smarter diff compression)
[ ] summarize.ts (Agent SDK summarization, optional)
[ ] Handle CLAUDE.md loading in fromClaudeLogs
[ ] Unit tests for all adapters
[ ] npm publish 0.3.0
```

**Definition of done:** All 5 tools have working adapters. `smarthandoff analyze` shows clear token allocation breakdown.

### Milestone 4 — Claude Code plugin (Week 7–8)

**Goal:** Zero-install experience for Claude Code users.

**Tasks:**

```
[ ] Create plugin manifest (manifest.json)
[ ] Implement /handoff skill (handoff.md)
[ ] Implement stopFailure.sh hook script
[ ] Implement preCompact.sh hook script
[ ] Test plugin install: /plugin install smart-handoff
[ ] Test /handoff --to gemini inside Claude Code
[ ] Test automatic StopFailure trigger
[ ] Test automatic PreCompact trigger
[ ] Submit to Claude Code plugin marketplace
[ ] Write blog post: "Smart Handoff — zero-friction AI session continuity"
[ ] npm publish 1.0.0
```

**Definition of done:** A new user installs the plugin with `/plugin install smart-handoff` and gets automatic handoff on rate limit with zero configuration.

---

## 16. Testing Strategy

### Unit tests — `packages/core/src/__tests__/`

```
fromClaudeLogs.test.ts
  ✓ parses user messages correctly
  ✓ strips tool_result events (noise)
  ✓ extracts Write/Edit tool calls as file changes
  ✓ extracts goal from first user message
  ✓ extracts blocker from last messages
  ✓ extracts decisions from pattern matches
  ✓ handles empty transcript gracefully
  ✓ handles transcript with only tool calls

fromGit.test.ts
  ✓ parses git status --porcelain correctly
  ✓ scores file importance correctly
  ✓ handles untracked files
  ✓ handles deleted files

merge.test.ts
  ✓ deduplicates files by path (git wins)
  ✓ generates stable IDs
  ✓ estimates token count

budgetAllocator.test.ts
  ✓ respects tool budget defaults
  ✓ gemini gets claudeMd budget, claude doesn't
  ✓ codex gets tight budget

adapters/*.test.ts
  ✓ each adapter produces correct deliveryMethod
  ✓ token count is within budget
  ✓ cursor adapter produces valid MDC frontmatter
  ✓ chatgpt adapter has systemPrompt field
  ✓ codex adapter produces AGENTS.md filesToWrite

policy/evaluator.test.ts
  ✓ rate_limit always returns auto+lean
  ✓ precompact with enough files returns auto+rich
  ✓ precompact with no files returns none
```

### Integration tests — `apps/cli/src/__tests__/`

```
route.integration.test.ts
  ✓ route --to gemini produces valid pipe output
  ✓ route --to cursor writes .cursor/rules/handoff.mdc
  ✓ route --to codex appends to AGENTS.md (if exists)
  ✓ route --auto selects installed tool
  ✓ route --preview prints without delivering

init.integration.test.ts
  ✓ creates .smarthandoff/ directory structure
  ✓ writes config.yaml
  ✓ adds hooks to ~/.claude/settings.json
  ✓ adds .smarthandoff/cache to .gitignore
```

### Test fixtures

```
packages/core/src/__tests__/fixtures/
├── sample-session.jsonl          ← real Claude Code transcript (anonymized)
├── sample-session-short.jsonl    ← short session with rate limit error
├── sample-session-decisions.jsonl ← session with clear decision patterns
└── mock-git-status.txt           ← mock git status --porcelain output
```

---

## 17. Publishing and Distribution

### npm publishing

Both packages published to npm under `@smarthandoff` scope:

```bash
# Bump versions with changesets
pnpm changeset add
pnpm changeset version

# Build and publish
pnpm publish-packages
```

### Package names

- `@smarthandoff/core` — library, for developers building on top
- `@smarthandoff/cli` — the CLI, published with binary
- The binary installs as both `smarthandoff` and `shoff`

### Install instructions (in README)

```bash
# Install globally
npm install -g @smarthandoff/cli

# Or use without installing
npx @smarthandoff/cli init

# Claude Code plugin (no npm needed)
/plugin install smart-handoff
```

### GitHub Actions CI/CD

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install
      - run: pnpm build
      - run: pnpm test
      - run: pnpm typecheck

# .github/workflows/publish.yml
name: Publish
on:
  push:
    branches: [main]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install
      - run: pnpm build
      - uses: changesets/action@v1
        with:
          publish: pnpm publish-packages
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## 18. File and Directory Reference

### Project root (when using smarthandoff)

```
your-project/
├── .smarthandoff/
│   ├── config.yaml             ← project config (commit this)
│   ├── handoffs/               ← saved handoffs (commit these)
│   │   └── shoff_*.json
│   ├── cache/                  ← compressed outputs (gitignored)
│   │   └── gemini_*.md
│   ├── events.jsonl            ← analytics (gitignored)
│   └── latest.md              ← most recent briefing (gitignored)
│
├── GEMINI.md                   ← written by gemini adapter (optional commit)
│
├── .cursor/
│   └── rules/
│       └── handoff.mdc         ← written by cursor adapter (temporary, gitignore)
│
└── AGENTS.md                   ← patched by codex adapter (section removed after use)
```

### Global (Claude Code hooks)

```
~/.claude/
├── settings.json               ← smart-handoff hooks registered here
└── projects/
    └── your-project/
        ├── *.jsonl             ← session transcripts (read by fromClaudeLogs)
        └── memory/             ← Claude auto-memory (read by fromMemory)
```

### Monorepo source

```
smart-handoff/
├── packages/core/src/
│   ├── types.ts                ← all TypeScript interfaces
│   ├── schema.ts               ← Zod validators + JSON schema
│   ├── index.ts                ← public API exports
│   ├── builders/               ← data collection
│   ├── compress/               ← token budget management
│   ├── adapters/               ← per-tool output generators
│   ├── policy/                 ← auto-trigger decisions
│   └── analytics/              ← event tracking
│
├── apps/cli/src/
│   ├── index.ts                ← CLI entry
│   ├── commands/               ← init, snapshot, resume, route, analyze, list
│   ├── deliver/                ← pipe, clipboard, file-write, two-part
│   ├── detect/                 ← tool detection
│   └── hooks/                  ← StopFailure, PreCompact scripts
│
└── plugins/claude-code/
    ├── manifest.json
    ├── skills/handoff.md       ← /handoff command
    └── hooks/                  ← shell scripts for auto-trigger
```

---

## Quick Reference

### Most important commands

```bash
# Setup (once per project)
smarthandoff init

# Primary use: switch tools
smarthandoff route --to gemini          # route to Gemini CLI
smarthandoff route --to codex           # route to Codex CLI
smarthandoff route --to cursor          # write Cursor rules file
smarthandoff route --auto               # auto-detect best tool

# Preview before sending
smarthandoff route --to gemini --preview

# Save state without routing
smarthandoff snapshot

# Resume from saved handoff
smarthandoff resume --to gemini

# Inspect what was captured
smarthandoff analyze
smarthandoff list

# Inside Claude Code
/handoff --to gemini
```

### Adapter quick reference

| Target | Delivery | Budget | Unique feature |
|---|---|---|---|
| `gemini` | stdin pipe | 50K | Writes GEMINI.md, full CLAUDE.md, search grounding |
| `codex` | stdin pipe | 8K | Patches AGENTS.md, file:line errors, sandbox flag |
| `cursor` | file write | 20K | Writes .cursor/rules/handoff.mdc, @file references |
| `claude` | clipboard | 15K | Shortest, reads auto-memory, mirrors /compact format |
| `chatgpt` | clipboard (2-part) | 20K | System prompt + first message, human-readable |
| `generic` | clipboard | 10K | Universal markdown, works anywhere |

---

*Smart Handoff — Implementation Plan v1.0 | April 2026*
*Ready to execute. Start with Milestone 1.*
