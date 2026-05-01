# @smarthandoff/core

Core library for [Smart Handoff](https://github.com/Manan-jn/smarthandoff) — zero-friction AI session continuity.

Extracts session state from Claude Code transcripts and compresses it into model-aware briefings for Gemini, Codex, Cursor, ChatGPT, and more. Zero LLM calls by default.

## Install

```bash
npm install @smarthandoff/core
```

## Usage

```typescript
import {
  fromClaudeLogs,
  fromGit,
  fromMemory,
  merge,
  toAdapter,
  compress,
  allocateBudget,
} from '@smarthandoff/core';

// Build a handoff from a Claude Code transcript
const partial = await fromClaudeLogs('/path/to/transcript.jsonl', {
  projectRoot: process.cwd(),
});

// Merge with git context
const gitPartial = await fromGit(process.cwd());
const handoff = merge([partial, gitPartial], {
  projectRoot: process.cwd(),
  createdBy: 'user@host',
  mode: 'rich',
});

// Render for Gemini (50K token budget)
const output = toAdapter(handoff, 'gemini');
console.log(output.text);
// → pipe to: gemini -i "You are resuming a coding task. Context is above."
```

## API

```typescript
// Builders
fromClaudeLogs(transcriptPath, options?)   // JSONL transcript → Partial<Handoff>
fromGit(repoPath, options?)                // git status + diff → Partial<Handoff>
fromMemory(projectRoot, transcriptPath?)   // Claude auto-memory → Partial<Handoff>
fromManual(options)                        // User notes → Partial<Handoff>
merge(partials[], options)                 // Partial<Handoff>[] → Handoff

// Compression
allocateBudget(handoff, target, budget?)   // → SectionBudgets
compress(handoff, budgets)                 // → Handoff (truncated to fit)

// Adapters
toAdapter(handoff, target, options?)       // → AdapterOutput (text + delivery metadata)

// Summarization (optional LLM pass)
summarize(handoff, options?)               // → Handoff (LLM-enhanced text fields)

// Utilities
validateHandoff(unknown)                   // → { success, data | error }
estimateTokens(text)                       // → number
TOOL_BUDGETS                               // Record<TargetTool, number>
```

## Supported targets

| Target | Token budget | Delivery |
|--------|-------------|----------|
| `gemini` | 50,000 | stdin pipe |
| `cursor` | 20,000 | file write (`.cursor/rules/handoff.mdc`) |
| `chatgpt` | 20,000 | two-part clipboard |
| `claude` | 15,000 | clipboard |
| `generic` | 10,000 | clipboard |
| `codex` | 8,000 | stdin pipe |

## Optional peer dependencies

Only install the SDK for the provider you use with `--summarize`:

```bash
npm install @anthropic-ai/sdk       # Anthropic provider
npm install @google/generative-ai   # Gemini provider
npm install openai                  # OpenAI provider
```

The `claude-cli` provider (default) requires no install — uses your existing Claude Code login.

## Full docs

See [github.com/Manan-jn/smarthandoff](https://github.com/Manan-jn/smarthandoff) for the complete README, CLI usage, and plugin docs.

## License

MIT
