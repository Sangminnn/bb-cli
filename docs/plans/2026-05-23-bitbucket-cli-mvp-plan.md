---
date: 2026-05-23
topic: bitbucket-cli-mvp
status: draft
---

# Bitbucket CLI MVP Plan

## Goal

Create a new `bb` CLI/library that provides a GitHub CLI-like command interface for Bitbucket, starting with Bitbucket Cloud.

The first version should let developers use familiar commands such as:

```bash
bb auth login
bb auth status
bb repo clone workspace/repo
bb pr list
bb pr view 123
bb pr create
bb pr checkout 123
bb api /repositories/workspace/repo/pullrequests
```

## Product Positioning

`bb` is not a wrapper around `gh`. It is a Bitbucket-native CLI that borrows the interaction model and command ergonomics of GitHub CLI.

Primary value:

- Reduce browser switching for Bitbucket workflows
- Make PR-centric Bitbucket development comfortable from the terminal
- Provide scriptable JSON output for automation
- Keep command names close to `gh` where the domain model matches
- Use Bitbucket terms where GitHub concepts do not map cleanly

## MVP Scope

### In Scope

#### 1. Auth

Commands:

```bash
bb auth login
bb auth status
bb auth logout
```

Initial auth method:

- Bitbucket Cloud app password or access token
- Store credentials locally in a config file or OS keychain if easy

Deferred:

- OAuth browser login
- Multiple accounts
- Bitbucket Data Center auth modes

#### 2. Repo

Commands:

```bash
bb repo clone <workspace>/<repo>
bb repo view [workspace/repo]
```

Behavior:

- Resolve repo slug and workspace
- Clone using HTTPS initially
- Show repository metadata from Bitbucket API

Deferred:

- SSH clone preference
- Repo create/fork/delete
- Workspace/project discovery UI

#### 3. Pull Requests

Commands:

```bash
bb pr list
bb pr view <id>
bb pr create
bb pr checkout <id>
bb pr merge <id>
```

Behavior:

- Default to current git remote when workspace/repo is omitted
- Support `--json` output for scriptability
- Support basic filters for `list`, such as state and author when practical
- `checkout` should fetch the PR source branch and check it out locally

Deferred:

- Review approval APIs
- Inline comments
- Advanced diff rendering
- Reviewer assignment UX polish

#### 4. API Escape Hatch

Command:

```bash
bb api <path> [--method GET|POST|PUT|DELETE] [--field key=value] [--raw-field key=value]
```

Behavior:

- Call Bitbucket Cloud REST API directly
- Reuse stored auth
- Print JSON response

This allows power users to access unsupported endpoints without waiting for first-class commands.

## Out of Scope for MVP

- `bb issue ...`
- `bb pipeline ...`
- `bb workspace ...`
- `bb project ...`
- `bb release ...`
- Bitbucket Server/Data Center support
- Full `gh` compatibility
- GUI/TUI flows

## Command Mapping

| GitHub CLI Style | Bitbucket CLI MVP |
|---|---|
| `gh auth login` | `bb auth login` |
| `gh auth status` | `bb auth status` |
| `gh repo clone owner/repo` | `bb repo clone workspace/repo` |
| `gh repo view` | `bb repo view` |
| `gh pr list` | `bb pr list` |
| `gh pr view 123` | `bb pr view 123` |
| `gh pr create` | `bb pr create` |
| `gh pr checkout 123` | `bb pr checkout 123` |
| `gh pr merge 123` | `bb pr merge 123` |
| `gh api ...` | `bb api ...` |

## Suggested Technical Direction

### Package Shape

Use TypeScript and Node.js for the first implementation.

Possible package structure:

```text
bb-bitbucket-cli/
  package.json
  tsconfig.json
  src/
    cli.ts
    commands/
      auth.ts
      repo.ts
      pr.ts
      api.ts
    bitbucket/
      client.ts
      endpoints.ts
      types.ts
    git/
      remote.ts
      checkout.ts
    config/
      credentials.ts
      settings.ts
  docs/
    plans/
```

### CLI Framework

Candidates:

- `commander` — simple, stable, enough for MVP
- `clipanion` — structured and type-friendly
- `oclif` — full CLI framework, more ceremony

Recommendation: start with `commander` for the MVP.

### HTTP Client

Use Node's built-in `fetch` if targeting modern Node versions.

### Output Modes

Default:

- Human-readable tables/summaries

Script mode:

```bash
bb pr list --json
bb pr view 123 --json
```

## Implementation Slices

### Slice 1 — Project scaffold

- Create npm package
- Add TypeScript build
- Add CLI entrypoint `bb`
- Add basic command routing
- Add `bb --version` and `bb --help`

### Slice 2 — Auth foundation

- Implement `bb auth login`
- Store token/app password locally
- Implement `bb auth status`
- Implement authenticated API client

### Slice 3 — API command

- Implement `bb api <path>`
- Add method support
- Add JSON request body/fields
- Validate authentication flow end-to-end

### Slice 4 — Git remote detection

- Parse current git remote
- Infer Bitbucket workspace and repo slug
- Support explicit `--repo workspace/repo` override

### Slice 5 — PR read commands

- Implement `bb pr list`
- Implement `bb pr view <id>`
- Add `--json`

### Slice 6 — PR write commands

- Implement `bb pr create`
- Implement `bb pr merge <id>`
- Add basic prompts/flags for title, body, source, destination

### Slice 7 — PR checkout

- Implement `bb pr checkout <id>`
- Fetch PR source branch
- Create local branch with predictable naming

### Slice 8 — Repo commands

- Implement `bb repo view`
- Implement `bb repo clone workspace/repo`

## Open Questions

1. Package name: `bb`, `bitbucket-cli`, or scoped package like `@your-scope/bb`?
2. Should credentials be stored in plain config initially, or should MVP use OS keychain from day one?
3. Should the first auth flow target app passwords, API tokens, OAuth, or all of them?
4. Should this be published as an npm package, a standalone binary, or both?
5. Should command behavior match `gh` flags closely, or only command names/subcommands?

## Recommended Next Step

Start with Slice 1 and Slice 2:

1. Scaffold a TypeScript CLI package under this folder
2. Implement command routing for `auth`, `repo`, `pr`, and `api`
3. Implement Bitbucket Cloud auth + `bb api` first

Once `bb api` works, the rest of the MVP can be built incrementally on top of the same client.
