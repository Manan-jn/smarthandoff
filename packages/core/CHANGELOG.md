# @smarthandoff/core

## 0.2.0

### Minor Changes

- v0.2.0 — launch support, extraction overhaul, animations, multi-provider summarization

  **CLI (`@smarthandoff/cli`)**

  - `--launch` flag: copies handoff to clipboard and spawns target CLI (gemini, codex, claude) interactively — no API key needed
  - Fixed `launchCommand` for all adapters: was generating a broken `cat | gemini -p` pipe that required an API key; now generates the correct interactive binary invocation
  - Fallback "Run:" message now says "paste with Cmd+V" — consistent with clipboard delivery
  - Added `ora` spinner + `chalk` colors throughout: spinners on build/summarize steps, colored bar chart in `list --inspect`, confidence score coloring, dim metadata vs. bold content
  - `--summarize` flag: LLM enhancement pass via auto | claude-cli | anthropic | gemini | openai | provider/model

  **Core (`@smarthandoff/core`)**

  - Extraction overhaul (`fromClaudeLogs`): last-edit-wins file deduplication, out-of-project path filtering, `redactSecrets` strips API keys before any LLM call
  - New fields: `goalProgression`, `sessionSegments`, `prLinks` — extracted from compact_boundary, last-prompt, pr-link, todo_reminder JSONL events
  - `summarize()` exported: multi-provider LLM enhancement pass (anthropic, gemini, openai, claude-cli)
  - Gemini adapter renders session history, goal progression, and active PR sections when present
