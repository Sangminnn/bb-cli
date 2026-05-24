import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBitbucketRemote, parseRepoRef } from './remote.js';

test('parseRepoRef parses workspace/repo', () => {
  assert.deepEqual(parseRepoRef('team/example'), { workspace: 'team', repo: 'example' });
});

test('parseRepoRef strips .git suffix', () => {
  assert.deepEqual(parseRepoRef('team/example.git'), { workspace: 'team', repo: 'example' });
});

test('parseBitbucketRemote parses ssh remotes', () => {
  assert.deepEqual(parseBitbucketRemote('git@bitbucket.org:team/example.git'), { workspace: 'team', repo: 'example' });
});

test('parseBitbucketRemote parses https remotes', () => {
  assert.deepEqual(parseBitbucketRemote('https://bitbucket.org/team/example.git'), { workspace: 'team', repo: 'example' });
});
