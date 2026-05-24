import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, Server } from 'node:http';
import test from 'node:test';

const SAMPLE_DIFF = `diff --git a/a.txt b/a.txt
new file mode 100644
index 0000000..ce01362
--- /dev/null
+++ b/a.txt
@@ -0,0 +1 @@
+hello
`;

test('bb pr diff fetches PR diff from a mock Bitbucket API', async () => {
  const server = await startMockBitbucketServer();
  try {
    const result = await runBb(['pr', 'diff', '1', '--repo', 'workspace/repo'], server.env);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, SAMPLE_DIFF);
    assert.equal(server.requests[0]?.url, '/2.0/repositories/workspace/repo/pullrequests/1/diff');
  } finally {
    await server.close();
  }
});

test('bb pr review pipes fetched PR diff into bundled review UI entrypoint', async () => {
  const server = await startMockBitbucketServer();
  const tempDir = await mkdtemp(join(tmpdir(), 'bb-review-ui-test-'));
  const capturedDiffPath = join(tempDir, 'captured.diff');
  const fakeReviewUiPath = join(tempDir, 'fake-review-ui.mjs');

  await writeFile(fakeReviewUiPath, `
import { writeFileSync } from 'node:fs';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  writeFileSync(${JSON.stringify(capturedDiffPath)}, input);
});
`);

  try {
    const result = await runBb(['pr', 'review', '1', '--repo', 'workspace/repo'], {
      ...server.env,
      BB_REVIEW_UI_ENTRYPOINT: fakeReviewUiPath,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(capturedDiffPath, 'utf8'), SAMPLE_DIFF);
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function startMockBitbucketServer(): Promise<{
  env: Record<string, string>;
  requests: Array<{ method?: string; url?: string; authorization?: string }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ method?: string; url?: string; authorization?: string }> = [];
  const server = createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    });

    if (req.url === '/2.0/repositories/workspace/repo/pullrequests/1/diff') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(SAMPLE_DIFF);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });

  await listen(server);
  const address = server.address();
  assert(address && typeof address === 'object');

  return {
    env: {
      BB_API_BASE_URL: `http://127.0.0.1:${address.port}/2.0`,
      BITBUCKET_USERNAME: 'user',
      BITBUCKET_APP_PASSWORD: 'token',
    },
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function runBb(args: string[], env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/cli.js', ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
