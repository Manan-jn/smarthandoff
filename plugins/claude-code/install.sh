#!/bin/bash
# Smart Handoff — Claude Code plugin installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Manan-jn/smarthandoff/main/plugins/claude-code/install.sh | bash

set -e

PLUGIN_DIR="$HOME/.claude/plugins/smart-handoff"
REPO="https://github.com/Manan-jn/smarthandoff"
RAW="https://raw.githubusercontent.com/Manan-jn/smarthandoff/main/plugins/claude-code"

echo "Installing Smart Handoff Claude Code plugin..."

mkdir -p "$PLUGIN_DIR/src/skills"
mkdir -p "$PLUGIN_DIR/src/hooks"

# Download plugin files
curl -fsSL "$RAW/src/manifest.json" -o "$PLUGIN_DIR/src/manifest.json"
curl -fsSL "$RAW/src/skills/handoff.md" -o "$PLUGIN_DIR/src/skills/handoff.md"
curl -fsSL "$RAW/src/hooks/stopFailure.sh" -o "$PLUGIN_DIR/src/hooks/stopFailure.sh"
curl -fsSL "$RAW/src/hooks/preCompact.sh" -o "$PLUGIN_DIR/src/hooks/preCompact.sh"

chmod +x "$PLUGIN_DIR/src/hooks/stopFailure.sh"
chmod +x "$PLUGIN_DIR/src/hooks/preCompact.sh"

echo ""
echo "✅ Smart Handoff plugin installed to $PLUGIN_DIR"
echo ""
echo "Restart Claude Code to activate the /handoff skill."
echo ""
echo "For CLI tools (smarthandoff route, resume, list, etc.):"
echo "  npm install -g @smarthandoff/cli"
echo ""
echo "Docs: $REPO"
