# bb-cli

> A GitHub CLI-inspired command line interface for Bitbucket Cloud, bundled with a browser-based PR review workspace.

[한국어 README](./README.ko.md)

## Overview

`bb-cli` aims to make Bitbucket Cloud workflows feel as convenient as GitHub CLI (`gh`).

It provides a `bb` command for common Bitbucket tasks:

```bash
bb auth login
bb api /user
bb repo view workspace/repo
bb pr list --repo workspace/repo
bb pr view 123 --repo workspace/repo
bb pr diff 123 --repo workspace/repo
bb pr review 123 --repo workspace/repo
```

The project also bundles a browser-based review UI, derived from `ko-difit`, so large pull request diffs can be inspected visually instead of being read only in the terminal.

## Status

MVP / experimental.

Verified locally:

- TypeScript build
- CLI unit tests
- mock Bitbucket API E2E tests
- `bb pr diff` mock flow
- `bb pr review` piping a fetched PR diff into the bundled review UI
- review UI startup from stdin diff

Not yet verified against a real Bitbucket PR:

- `bb auth login` with a real Bitbucket account
- `bb pr review <id>` against a real PR
- browser visual review against a real PR diff
- publishing inline comments back to Bitbucket

## Package Structure

```text
packages/
  cli/        # bb CLI
  review-ui/ # bundled PR review workspace based on ko-difit
```

Responsibilities:

- `packages/cli`
  - Bitbucket Cloud authentication
  - Bitbucket REST API calls
  - repository and pull request commands
  - PR diff fetching
  - launching the bundled review UI
- `packages/review-ui`
  - browser-based unified/split diff viewer
  - local review comments
  - optional agent-assisted discussion

## Development

```bash
npm install
npm run build
npm test
```

Run the CLI directly:

```bash
node packages/cli/dist/cli.js --help
node packages/cli/dist/cli.js pr --help
```

Use it as a linked local CLI:

```bash
npm link -w packages/cli
bb --help
```

## Authentication

The MVP uses Bitbucket Cloud username + app password/API token authentication.

```bash
bb auth login
bb auth status
bb auth logout
```

For non-interactive usage:

```bash
BITBUCKET_USERNAME=your-id \
BITBUCKET_APP_PASSWORD=your-token \
bb api /user
```

Credentials are stored at:

```text
~/.config/bb-cli/config.json
```

## Commands

### API

```bash
bb api /user
bb api /repositories/workspace/repo
bb api /repositories/workspace/repo/pullrequests
```

### Repository

```bash
bb repo view workspace/repo
bb repo clone workspace/repo
bb repo clone workspace/repo my-folder
```

### Pull Requests

```bash
bb pr list --repo workspace/repo
bb pr view 123 --repo workspace/repo
bb pr create --repo workspace/repo --title "Fix bug" --head fix/bug --base main
bb pr checkout 123 --repo workspace/repo
bb pr merge 123 --repo workspace/repo
```

### PR Diff

Print a patch in the terminal:

```bash
bb pr diff 123 --repo workspace/repo
```

Open the diff in the bundled review UI:

```bash
bb pr diff 123 --repo workspace/repo --web
```

### PR Review Workspace

```bash
bb pr review 123 --repo workspace/repo
```

Flow:

1. Fetch the Bitbucket Cloud PR diff.
2. Pipe the unified diff into the bundled review UI.
3. Open a browser-based diff review workspace.
4. Keep the agent orchestrator disabled by default.

Enable agent-assisted discussion explicitly:

```bash
bb pr review 123 --repo workspace/repo --agent
```

### Agent Providers

The review UI orchestrator now uses a provider layer instead of being hard-wired to Claude Code.

```bash
DIFIT_AGENT_PROVIDER=claude # default, backward-compatible
DIFIT_AGENT_PROVIDER=pi
DIFIT_AGENT_PROVIDER=codex
DIFIT_AGENT_PROVIDER=auto
DIFIT_AGENT_PROVIDER=custom
DIFIT_AGENT_PROVIDER=none
```

Useful provider-specific environment variables:

```bash
# Claude Code-compatible provider
CLAUDE_BIN=claude
CLAUDE_MODEL=opus

# pi provider
PI_BIN=pi
PI_MODEL=openai/gpt-4o

# Codex provider
CODEX_BIN=codex
CODEX_MODEL=gpt-5.1-codex

# Custom stdin/stdout agent command
DIFIT_AGENT_PROVIDER=custom
DIFIT_AGENT_COMMAND=/path/to/agent-command
```

Provider behavior:

- `claude`: uses Claude Code print mode with session resume support.
- `pi`: uses `pi -p` in no-session/full-history mode.
- `codex`: uses `codex exec` in full-history mode.
- `custom`: executes a stdin/stdout command.
- `auto`: picks the first available provider from `pi`, `claude`, `codex`.
- `none`: disables agent replies.

## GitHub CLI Mapping

| GitHub CLI | bb CLI |
|---|---|
| `gh auth login` | `bb auth login` |
| `gh repo clone owner/repo` | `bb repo clone workspace/repo` |
| `gh repo view` | `bb repo view` |
| `gh pr list` | `bb pr list` |
| `gh pr view 123` | `bb pr view 123` |
| `gh pr create` | `bb pr create` |
| `gh pr checkout 123` | `bb pr checkout 123` |
| `gh pr merge 123` | `bb pr merge 123` |
| `gh api ...` | `bb api ...` |

## Testing Without a Real Bitbucket Account

The CLI supports a mockable API base URL:

```bash
BB_API_BASE_URL=http://127.0.0.1:4000/2.0
```

Automated tests use this to verify:

```text
bb pr diff
→ receives diff from mock Bitbucket API
→ prints patch

bb pr review
→ receives diff from mock Bitbucket API
→ pipes diff into review-ui stdin
```

Run:

```bash
npm test
```

## Roadmap

Potential next steps:

1. Pass Bitbucket PR metadata into the review UI.
2. Separate local notes, agent questions, and publishable PR comments.
3. Publish selected review comments as Bitbucket inline comments.
4. Add `bb pr comments publish <id> --file comments.json`.
5. Add agent provider abstraction: `none`, `auto`, `claude`, `pi`, `codex`.
6. Add pipeline status/log commands.
7. Add workspace/project discovery commands.

## License

MIT
