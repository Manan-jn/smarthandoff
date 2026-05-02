# @smarthandoff/core

Core library for [Smart Handoff](https://github.com/Manan-jn/smarthandoff) — extracts AI session state from Claude Code transcripts and compresses it into model-aware briefings for any AI tool.

**Zero LLM calls by default. Fully deterministic. No API keys required.**

---

## Install

```bash
npm install @smarthandoff/core
```

---

## Quick example

```typescript
import { fromClaudeLogs, fromGit, merge, toAdapter } from '@smarthandoff/core';

// Extract state from a Claude Code JSONL transcript
const sessionPartial = await fromClaudeLogs('/path/to/transcript.jsonl', {
  projectRoot: process.cwd(),
});

// Merge with git context
const gitPartial = await fromGit(process.cwd());
const handoff = merge([sessionPartial, gitPartial], {
  projectRoot: process.cwd(),
  createdBy: 'user@host',
  mode: 'rich',
});

// Render a compressed briefing for Gemini (50K token budget)
const output = toAdapter(handoff, 'gemini');
console.log(output.text);          // markdown briefing ready to paste
console.log(output.tokenCount);    // estimated token count
console.log(output.launchCommand); // "gemini --skip-trust"
```

---

## API

### Builders

Extract partial handoff state from different sources. All return `Partial<Handoff>` and can be merged.

```typescript
// From a Claude Code JSONL transcript
fromClaudeLogs(transcriptPath: string, options?: {
  projectRoot?: string;  // filter files outside this path
}): Promise<Partial<Handoff>>

// From git status + diff stats
fromGit(repoPath: string, options?: {
  includeDiffs?: boolean;  // embed full diff text (default: false)
}): Promise<Partial<Handoff>>

// From Claude auto-memory (~/.claude/projects/.../memory/)
fromMemory(projectRoot: string, transcriptPath?: string): Promise<Partial<Handoff>>

// From a manual note
fromManual(options: { note: string }): Partial<Handoff>
```

**What `fromClaudeLogs` extracts:**
- Goal from the last `last-prompt` event, falling back to first user message
- Goal progression (all `last-prompt` events — shows how focus evolved)
- Files changed via `Write`/`Edit` tool calls — last-edit-wins (no duplicates)
- Decisions from assistant messages matching decision patterns
- Blockers from error messages and the final assistant turn
- Next steps from pending `todo_reminder` tasks
- PR links from `pr-link` events
- Session segments from `compact_boundary` events (prior context windows)
- API keys automatically redacted from all extracted text

### Merge

Combine multiple partials into a single validated `Handoff` object:

```typescript
merge(partials: Partial<Handoff>[], options: {
  projectRoot?: string;
  sessionId?: string;
  createdBy?: string;
  mode?: 'lean' | 'rich' | 'debug';
}): Handoff
```

### Compression

```typescript
// Compute per-section token budgets for a target tool
allocateBudget(handoff: Handoff, target: TargetTool, budget?: number): SectionBudgets

// Compress a handoff to fit within the computed budgets
compress(handoff: Handoff, budgets: SectionBudgets): Handoff
```

### Adapters

Render a compressed briefing for a specific target tool:

```typescript
toAdapter(handoff: Handoff, target: TargetTool, options?: {
  tokenBudget?: number;  // override default budget
  mode?: 'lean' | 'rich' | 'debug';
}): AdapterOutput
```

`AdapterOutput` shape:

```typescript
interface AdapterOutput {
  text: string;              // formatted briefing — ready to paste
  tokenCount: number;        // estimated tokens
  deliveryMethod: 'pipe' | 'clipboard' | 'file-write' | 'two-part-clipboard';
  targetTool: TargetTool;
  launchCommand?: string;    // e.g. "gemini --skip-trust"
  systemPrompt?: string;     // chatgpt two-part format only
  filesToWrite?: Array<{ path: string; content: string; isTemporary: boolean }>;
}
```

### Summarization (optional LLM pass)

Enhance extracted fields using any LLM provider:

```typescript
import { summarize } from '@smarthandoff/core';

const enhanced = await summarize(handoff, {
  provider?: 'claude-cli' | 'anthropic' | 'gemini' | 'openai';  // default: auto
  model?: string;  // e.g. 'gemini-2.5-flash', 'gpt-4o'
});
```

| Provider | Env var needed | Notes |
|----------|---------------|-------|
| `claude-cli` | — | Uses the installed `claude` binary |
| `gemini` | `GEMINI_API_KEY` | — |
| `openai` | `OPENAI_API_KEY` | — |
| `anthropic` | `ANTHROPIC_API_KEY` | — |

---

## Target tools and budgets

```typescript
type TargetTool = 'gemini' | 'codex' | 'cursor' | 'claude' | 'chatgpt' | 'generic';
```

| Target | Default budget | Output format |
|--------|---------------|---------------|
| `gemini` | 50,000 | Markdown with `## CONTEXT` header + sections |
| `claude` | 15,000 | `## Session resume` format |
| `codex` | 8,000 | `TASK:`/`FILE:` prefix style |
| `cursor` | 12,000 | MDC rule file for `.cursor/rules/` |
| `chatgpt` | 12,000 | Two-part system prompt + user message |
| `generic` | 10,000 | Plain markdown |

---

## Data model

```typescript
interface Handoff {
  id: string;                        // "shoff_<timestamp>_<source>"
  createdAt: string;                 // ISO timestamp
  sources: HandoffSource[];          // which collectors contributed
  rawTokenCount: number;             // estimated tokens before compression
  extractionConfidence: number;      // 0–1

  goals: HandoffGoal[];              // what was being worked on
  goalProgression?: string[];        // how the goal evolved across the session
  filesChanged: HandoffFileChange[]; // files written or edited (last-edit-wins)
  decisions: HandoffDecision[];      // decisions made during the session
  blockers: HandoffBlocker[];        // current blockers / errors
  nextSteps: HandoffNextStep[];      // what to do next

  sessionSegments?: HandoffSessionSegment[];  // prior context windows (post-compaction)
  prLinks?: string[];                         // PR URLs found in session

  context: HandoffProjectContext;    // stack, CLAUDE.md, package.json, git branch
  notes?: string;                    // manual notes injected via --note
}
```

---

## Utilities

```typescript
estimateTokens(text: string): number
// Approximate token count (character-based heuristic)

getRelativeTime(isoTimestamp: string): string
// "2 hours ago", "30 mins ago", etc.

redactSecrets(text: string): string
// Strips API keys matching 5 patterns (gemini, openai, anthropic, npm, github)

validateHandoff(raw: unknown): { success: true; data: Handoff } | { success: false; error: string }
// Parse and validate raw JSON from disk

const TOOL_BUDGETS: Record<TargetTool, number>
// Default token budget per target tool
```

---

## Full documentation

See [github.com/Manan-jn/smarthandoff](https://github.com/Manan-jn/smarthandoff) for architecture, CLI docs, and the Claude Code plugin.

## License

MIT
