---
date: 2026-05-24
topic: bundled-review-ui-roadmap
status: draft
---

# Bundled Review UI Roadmap

## Direction

`bb` should ship as a single installable Bitbucket CLI that includes a browser-based PR review workspace. The review workspace is based on ko-difit, but is packaged inside this repository as `@bb-bitbucket-cli/review-ui` and exposed through `bb pr review`.

## Product Boundary

- `packages/cli`: Bitbucket auth, PR API, repository detection, publishing comments to Bitbucket.
- `packages/review-ui`: Diff visualization, local review threads, optional agent-assisted discussion.
- Future bridge: agent provider adapters and selected comment publishing.

## Initial Behavior

```bash
bb pr review 123 --repo workspace/repo
```

Flow:

1. Fetch Bitbucket Cloud PR diff.
2. Pipe unified diff into bundled review UI.
3. Open browser diff workspace.
4. Disable agent orchestrator by default.

Agent mode is explicit:

```bash
bb pr review 123 --agent
bb pr diff 123 --web --agent
```

## Why Agent Is Optional

The first-order value is PR diff visibility. Agent ping-pong is valuable for reviewer thought-work, but should not be required for Bitbucket PR inspection and should not impose Claude/Codex/pi compatibility decisions on the MVP path.

## Next Slices

1. Add Bitbucket review session metadata file support.
2. Separate local notes, agent questions, and publishable PR comments in review UI.
3. Add export format for selected publishable comments.
4. Add `bb pr comments publish <id> --file comments.json`.
5. Add agent provider abstraction: `auto`, `claude`, `pi`, `codex`, `none`.
