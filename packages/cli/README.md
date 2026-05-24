# bb-bitbucket-cli

A GitHub CLI-inspired command line interface for Bitbucket Cloud.

## Status

MVP scaffold. Initial focus:

- `bb auth login|status|logout`
- `bb api`
- `bb repo view|clone`
- `bb pr list|view|create|checkout|merge`

## Development

```bash
npm install
npm run build
npm run dev -- --help
```

## Authentication

For the MVP, authenticate with a Bitbucket Cloud username and app password/API token:

```bash
bb auth login
```

Credentials are stored at `~/.config/bb-cli/config.json` unless `BB_CONFIG_HOME` is set.

You can also use environment variables for non-interactive usage:

```bash
BITBUCKET_USERNAME=you BITBUCKET_APP_PASSWORD=token bb pr list --repo workspace/repo
```
