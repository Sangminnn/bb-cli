#!/usr/bin/env bash
# codereview-skill — Claude Code slash skill wrapper for the codereview-viewer.
#
# Runs the built CLI directly (publish-parity behaviour) targeting the caller's
# current repository. The CLI spawns the orchestrator-watcher itself. Exits when
# the user closes the browser tab.
#
# Usage:
#   codereview-skill [<target-repo>]   # default: $PWD

set -euo pipefail

TARGET="${1:-$PWD}"

if ! TARGET_ABS="$(cd "$TARGET" 2>/dev/null && pwd -P)"; then
  echo "codereview: target directory not found: $TARGET" >&2
  exit 1
fi

if ! git -C "$TARGET_ABS" rev-parse --git-dir >/dev/null 2>&1; then
  echo "codereview: '$TARGET_ABS' is not inside a git repository" >&2
  exit 1
fi

SCRIPT_PATH="${BASH_SOURCE[0]}"
while [[ -L "$SCRIPT_PATH" ]]; do
  link_dir="$(cd -P "$(dirname "$SCRIPT_PATH")" && pwd)"
  link_target="$(readlink "$SCRIPT_PATH")"
  if [[ "$link_target" != /* ]]; then
    SCRIPT_PATH="$link_dir/$link_target"
  else
    SCRIPT_PATH="$link_target"
  fi
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" && pwd)"
VIEWER_DIR="$(dirname "$SCRIPT_DIR")"
CLI_ENTRY="$VIEWER_DIR/dist/cli/index.js"

if [[ ! -f "$CLI_ENTRY" ]]; then
  echo "codereview: built CLI not found at $CLI_ENTRY" >&2
  echo "codereview: run 'pnpm build' inside $VIEWER_DIR first" >&2
  exit 2
fi

echo "codereview: target = $TARGET_ABS" >&2
echo "codereview: viewer = $VIEWER_DIR" >&2
echo "codereview: close the browser tab to end the review." >&2

cd "$TARGET_ABS"
exec node "$CLI_ENTRY" working --include-untracked
