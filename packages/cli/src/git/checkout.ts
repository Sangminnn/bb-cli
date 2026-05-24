import { BitbucketClient } from '../bitbucket/client.js';
import { CliError, isRecord } from '../errors.js';
import { RepoRef } from '../types.js';
import { git, repoPath } from './remote.js';

export async function checkoutPullRequest(client: BitbucketClient, ref: RepoRef, id: string): Promise<string> {
  const payload = await client.request(`${repoPath(ref)}/pullrequests/${encodeURIComponent(id)}`);
  if (!isRecord(payload)) throw new CliError('Unexpected pull request response.');

  const source = payload.source;
  if (!isRecord(source)) throw new CliError('Pull request has no source branch.');

  const branch = isRecord(source.branch) && typeof source.branch.name === 'string' ? source.branch.name : undefined;
  const repository = isRecord(source.repository) ? source.repository : undefined;
  const links = repository && isRecord(repository.links) ? repository.links : undefined;
  const cloneLinks = links && isRecord(links.clone) && Array.isArray(links.clone) ? links.clone : undefined;

  if (!branch) throw new CliError('Pull request source branch is missing.');

  const remoteName = `bb-pr-${id}`;
  const localBranch = `pr-${id}-${branch.replace(/[^a-zA-Z0-9._/-]/g, '-')}`;
  const cloneUrl = findHttpsCloneUrl(cloneLinks) ?? undefined;

  if (cloneUrl) {
    await git(['remote', 'remove', remoteName]).catch(() => '');
    await git(['remote', 'add', remoteName, cloneUrl]);
    await git(['fetch', remoteName, branch]);
    await git(['checkout', '-B', localBranch, `FETCH_HEAD`]);
    return localBranch;
  }

  await git(['fetch', 'origin', branch]);
  await git(['checkout', '-B', localBranch, `FETCH_HEAD`]);
  return localBranch;
}

function findHttpsCloneUrl(cloneLinks: unknown): string | undefined {
  if (!Array.isArray(cloneLinks)) return undefined;
  for (const link of cloneLinks) {
    if (isRecord(link) && link.name === 'https' && typeof link.href === 'string') {
      return link.href;
    }
  }
  return undefined;
}
