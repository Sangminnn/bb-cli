import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CliError } from '../errors.js';
import { RepoRef } from '../types.js';

const execFileAsync = promisify(execFile);

export async function git(args: string[], options?: { cwd?: string }): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: options?.cwd });
  return stdout.trim();
}

export async function inferRepoRef(explicit?: string): Promise<RepoRef> {
  if (explicit) return parseRepoRef(explicit);

  const remoteUrl = await git(['remote', 'get-url', 'origin']).catch(() => '');
  if (!remoteUrl) {
    throw new CliError('Could not infer repository. Pass --repo workspace/repo.');
  }
  return parseBitbucketRemote(remoteUrl);
}

export function parseRepoRef(value: string): RepoRef {
  const [workspace, repo] = value.split('/');
  if (!workspace || !repo) {
    throw new CliError(`Invalid repo "${value}". Expected workspace/repo.`);
  }
  return { workspace, repo: repo.replace(/\.git$/, '') };
}

export function parseBitbucketRemote(remoteUrl: string): RepoRef {
  const patterns = [
    /bitbucket\.org[:/]([^/]+)\/([^/]+?)(?:\.git)?$/,
    /bitbucket\.org\/scm\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = remoteUrl.match(pattern);
    if (match?.[1] && match[2]) {
      return { workspace: match[1], repo: match[2].replace(/\.git$/, '') };
    }
  }

  throw new CliError(`Remote origin is not a recognized Bitbucket URL: ${remoteUrl}`);
}

export function repoPath(ref: RepoRef): string {
  return `/repositories/${encodeURIComponent(ref.workspace)}/${encodeURIComponent(ref.repo)}`;
}
