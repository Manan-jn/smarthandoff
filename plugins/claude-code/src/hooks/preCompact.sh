#!/bin/bash
# Smart Handoff — PreCompact hook
# Fires when Claude Code context window is filling up
# Runs async — must not block compaction

if command -v smarthandoff &> /dev/null; then
  # Run in background — don't block compaction
  smarthandoff snapshot --mode lean --source precompact &
  echo "Smart Handoff: background snapshot started (pid $!)" >&2
fi

# Never block compaction
exit 0
