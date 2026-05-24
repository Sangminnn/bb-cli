import assert from 'node:assert/strict';
import test from 'node:test';
import { BitbucketClient } from './client.js';

test('BitbucketClient sends basic auth and parses JSON', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), 'https://api.bitbucket.org/2.0/repositories/team/repo');
      assert.equal(init?.headers && (init.headers as Record<string, string>).Accept, 'application/json');
      assert.match(String(init?.headers && (init.headers as Record<string, string>).Authorization), /^Basic /);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const client = new BitbucketClient({ username: 'u', appPassword: 'p' });
    assert.deepEqual(await client.request('/repositories/team/repo'), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BitbucketClient can fetch text responses such as PR diffs', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), 'https://api.bitbucket.org/2.0/repositories/team/repo/pullrequests/1/diff');
      assert.match(String(init?.headers && (init.headers as Record<string, string>).Accept), /text\/x-diff/);
      return new Response('diff --git a/a.txt b/a.txt\n', { status: 200 });
    }) as typeof fetch;

    const client = new BitbucketClient({ username: 'u', appPassword: 'p' });
    assert.equal(await client.requestText('/repositories/team/repo/pullrequests/1/diff'), 'diff --git a/a.txt b/a.txt\n');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
