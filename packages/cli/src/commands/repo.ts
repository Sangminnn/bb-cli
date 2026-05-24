import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { BitbucketClient } from '../bitbucket/client.js';
import { loadCredentials } from '../config/credentials.js';
import { compactText, printJson } from '../format.js';
import { inferRepoRef, parseRepoRef, repoPath } from '../git/remote.js';
import { isRecord } from '../errors.js';

export function registerRepo(program: Command): void {
  const repo = program.command('repo').description('Work with Bitbucket repositories');

  repo.command('view')
    .description('View repository metadata')
    .argument('[repo]', 'workspace/repo')
    .option('--json', 'Print raw JSON')
    .action(async (repoArg: string | undefined, options: { json?: boolean }) => {
      const credentials = await loadCredentials();
      const ref = await inferRepoRef(repoArg);
      const client = new BitbucketClient(credentials);
      const result = await client.request(repoPath(ref));
      if (options.json) return printJson(result);
      printRepoSummary(result);
    });

  repo.command('clone')
    .description('Clone a Bitbucket repository')
    .argument('<repo>', 'workspace/repo')
    .argument('[directory]', 'target directory')
    .action(async (repoArg: string, directory?: string) => {
      const ref = parseRepoRef(repoArg);
      const url = `https://bitbucket.org/${ref.workspace}/${ref.repo}.git`;
      const args = ['clone', url];
      if (directory) args.push(directory);
      await runGit(args);
    });
}

async function runGit(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function printRepoSummary(payload: unknown): void {
  if (!isRecord(payload)) return printJson(payload);
  console.log(`${payload.full_name ?? payload.name ?? 'Repository'}`);
  if (payload.description) console.log(compactText(payload.description));
  if (payload.links && isRecord(payload.links) && isRecord(payload.links.html) && typeof payload.links.html.href === 'string') {
    console.log(payload.links.html.href);
  }
}
