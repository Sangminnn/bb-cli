import { Command } from 'commander';
import { BitbucketClient } from '../bitbucket/client.js';
import { loadCredentials } from '../config/credentials.js';
import { CliError, isRecord } from '../errors.js';
import { compactText, printJson, printTable } from '../format.js';
import { checkoutPullRequest } from '../git/checkout.js';
import { inferRepoRef, repoPath } from '../git/remote.js';
import { prompt } from '../prompt.js';
import { openReviewUi } from '../review-ui.js';

export function registerPr(program: Command): void {
  const pr = program.command('pr').description('Work with Bitbucket pull requests');

  pr.command('list')
    .description('List pull requests')
    .option('-R, --repo <repo>', 'workspace/repo')
    .option('-s, --state <state>', 'OPEN, MERGED, DECLINED, SUPERSEDED', 'OPEN')
    .option('-l, --limit <limit>', 'maximum number of pull requests', '20')
    .option('--json', 'Print raw JSON')
    .action(async (options: { repo?: string; state: string; limit: string; json?: boolean }) => {
      const { client, ref } = await context(options.repo);
      const path = `${repoPath(ref)}/pullrequests?state=${encodeURIComponent(options.state)}&pagelen=${encodeURIComponent(options.limit)}`;
      const result = await client.request(path);
      if (options.json) return printJson(result);
      const values = isRecord(result) && Array.isArray(result.values) ? result.values : [];
      printTable(values.map((item) => summarizePr(item)), ['id', 'state', 'title', 'source', 'destination', 'author']);
    });

  pr.command('view')
    .description('View a pull request')
    .argument('<id>', 'pull request id')
    .option('-R, --repo <repo>', 'workspace/repo')
    .option('--json', 'Print raw JSON')
    .action(async (id: string, options: { repo?: string; json?: boolean }) => {
      const { client, ref } = await context(options.repo);
      const result = await client.request(`${repoPath(ref)}/pullrequests/${encodeURIComponent(id)}`);
      if (options.json) return printJson(result);
      printPr(result);
    });

  pr.command('diff')
    .description('Show or open a pull request diff')
    .argument('<id>', 'pull request id')
    .option('-R, --repo <repo>', 'workspace/repo')
    .option('--web', 'Open the diff in the bundled review UI')
    .option('--agent', 'Enable review-ui agent ping-pong while opened with --web')
    .option('--mode <mode>', 'review UI diff mode: split or unified', 'split')
    .action(async (id: string, options: { repo?: string; web?: boolean; agent?: boolean; mode: 'split' | 'unified' }) => {
      const { client, ref } = await context(options.repo);
      const diff = await fetchPullRequestDiff(client, ref, id);
      if (options.web) {
        await openReviewUi({ diff, agent: options.agent, mode: options.mode });
        return;
      }
      process.stdout.write(diff);
    });

  pr.command('review')
    .description('Open a pull request diff in the bundled review UI')
    .argument('<id>', 'pull request id')
    .option('-R, --repo <repo>', 'workspace/repo')
    .option('--agent', 'Enable agent ping-pong in review UI')
    .option('--mode <mode>', 'review UI diff mode: split or unified', 'split')
    .option('--clean', 'Start with a clean review session')
    .action(async (id: string, options: { repo?: string; agent?: boolean; mode: 'split' | 'unified'; clean?: boolean }) => {
      const { client, ref } = await context(options.repo);
      const diff = await fetchPullRequestDiff(client, ref, id);
      await openReviewUi({ diff, agent: options.agent, mode: options.mode, clean: options.clean });
    });

  pr.command('create')
    .description('Create a pull request')
    .option('-R, --repo <repo>', 'workspace/repo')
    .option('-t, --title <title>', 'pull request title')
    .option('-b, --body <body>', 'pull request description')
    .option('-H, --head <branch>', 'source branch')
    .option('-B, --base <branch>', 'destination branch', 'main')
    .option('--close-source-branch', 'close source branch after merge')
    .option('--json', 'Print raw JSON')
    .action(async (options: { repo?: string; title?: string; body?: string; head?: string; base: string; closeSourceBranch?: boolean; json?: boolean }) => {
      const { client, ref } = await context(options.repo);
      const title = options.title ?? await prompt('Title');
      const source = options.head ?? await prompt('Source branch');
      const destination = options.base ?? await prompt('Destination branch', { defaultValue: 'main' });
      const body = options.body ?? await prompt('Description', { defaultValue: '' });
      const result = await client.request(`${repoPath(ref)}/pullrequests`, {
        method: 'POST',
        body: {
          title,
          description: body,
          source: { branch: { name: source } },
          destination: { branch: { name: destination } },
          close_source_branch: Boolean(options.closeSourceBranch),
        },
      });
      if (options.json) return printJson(result);
      printPr(result);
    });

  pr.command('merge')
    .description('Merge a pull request')
    .argument('<id>', 'pull request id')
    .option('-R, --repo <repo>', 'workspace/repo')
    .option('-m, --message <message>', 'merge commit message')
    .option('--close-source-branch', 'close source branch')
    .option('--json', 'Print raw JSON')
    .action(async (id: string, options: { repo?: string; message?: string; closeSourceBranch?: boolean; json?: boolean }) => {
      const { client, ref } = await context(options.repo);
      const body: Record<string, unknown> = {
        close_source_branch: Boolean(options.closeSourceBranch),
      };
      if (options.message) body.message = options.message;
      const result = await client.request(`${repoPath(ref)}/pullrequests/${encodeURIComponent(id)}/merge`, { method: 'POST', body });
      if (options.json) return printJson(result);
      console.log(`Merged pull request #${id}.`);
    });

  pr.command('checkout')
    .description('Check out a pull request source branch locally')
    .argument('<id>', 'pull request id')
    .option('-R, --repo <repo>', 'workspace/repo')
    .action(async (id: string, options: { repo?: string }) => {
      const { client, ref } = await context(options.repo);
      const branch = await checkoutPullRequest(client, ref, id);
      console.log(`Checked out ${branch}.`);
    });
}

async function context(repo?: string): Promise<{ client: BitbucketClient; ref: Awaited<ReturnType<typeof inferRepoRef>> }> {
  const credentials = await loadCredentials();
  const ref = await inferRepoRef(repo);
  return { client: new BitbucketClient(credentials), ref };
}

async function fetchPullRequestDiff(client: BitbucketClient, ref: Awaited<ReturnType<typeof inferRepoRef>>, id: string): Promise<string> {
  const path = `${repoPath(ref)}/pullrequests/${encodeURIComponent(id)}/diff`;
  const diff = await client.requestText(path);
  if (!diff.trim()) throw new CliError(`Pull request #${id} has an empty diff.`);
  return diff;
}

function summarizePr(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return {
    id: value.id,
    state: value.state,
    title: compactText(value.title),
    source: branchName(value.source),
    destination: branchName(value.destination),
    author: displayName(value.author),
  };
}

function printPr(payload: unknown): void {
  if (!isRecord(payload)) return printJson(payload);
  console.log(`#${payload.id ?? '?'} ${payload.title ?? ''}`);
  console.log(`State: ${payload.state ?? ''}`);
  console.log(`Source: ${branchName(payload.source)} -> ${branchName(payload.destination)}`);
  const author = displayName(payload.author);
  if (author) console.log(`Author: ${author}`);
  if (payload.links && isRecord(payload.links) && isRecord(payload.links.html) && typeof payload.links.html.href === 'string') {
    console.log(payload.links.html.href);
  }
  if (payload.description) {
    console.log('');
    console.log(compactText(payload.description));
  }
}

function branchName(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.branch) || typeof value.branch.name !== 'string') return '';
  return value.branch.name;
}

function displayName(value: unknown): string {
  if (!isRecord(value)) return '';
  if (typeof value.display_name === 'string') return value.display_name;
  if (typeof value.nickname === 'string') return value.nickname;
  return '';
}
