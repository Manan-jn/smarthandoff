#!/bin/bash
# Smart Handoff — StopFailure hook
# Fires when Claude Code hits a rate limit or stop error
# Input: JSON on stdin with { error, transcript_path, ... }

INPUT=$(cat)

# Check if this is a rate limit error
ERROR=$(echo "$INPUT" | node -e "
  try {
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
    process.stdout.write(d.error || d.stop_reason || '');
  } catch(e) { process.stdout.write(''); }
" 2>/dev/null || echo "")

if [ "$ERROR" = "rate_limit" ] || echo "$ERROR" | grep -qi "rate.limit"; then
  echo "⚡ Rate limit hit — generating Smart Handoff..." >&2

  if command -v smarthandoff &> /dev/null; then
    smarthandoff route --trigger rate_limit --mode lean
  else
    # Fallback: copy last context to clipboard
    TRANSCRIPT=$(echo "$INPUT" | node -e "
      try {
        const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
        process.stdout.write(d.transcript_path || '');
      } catch(e) { process.stdout.write(''); }
    " 2>/dev/null || echo "")

    if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
      LAST_USER=$(node -e "
        const fs = require('fs');
        try {
          const lines = fs.readFileSync('$TRANSCRIPT', 'utf8').trim().split('\n');
          const userMsgs = lines
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(e => e && e.type === 'user');
          const last = userMsgs[userMsgs.length - 1];
          const content = last?.message?.content;
          process.stdout.write(typeof content === 'string' ? content : JSON.stringify(content));
        } catch(e) { process.stdout.write(''); }
      " 2>/dev/null || echo "")

      if [ -n "$LAST_USER" ]; then
        echo "$LAST_USER" | pbcopy 2>/dev/null || echo "$LAST_USER" | xclip -selection clipboard 2>/dev/null || true
        echo "✓ Last context copied to clipboard" >&2
      fi
    fi
  fi
fi

# StopFailure hooks must always exit 0
exit 0
