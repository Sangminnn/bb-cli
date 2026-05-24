import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CliError } from './errors.js';

const require = createRequire(import.meta.url);

export type ReviewUiOptions = {
  diff: string;
  agent?: boolean;
  mode?: 'split' | 'unified';
  clean?: boolean;
  metadata?: unknown;
};

export async function openReviewUi(options: ReviewUiOptions): Promise<void> {
  const entrypoint = resolveReviewUiEntrypoint();
  const args = [entrypoint, '-'];
  const metadataTempDir = options.metadata ? await mkdtemp(join(tmpdir(), 'bb-review-metadata-')) : undefined;
  const metadataPath = metadataTempDir ? join(metadataTempDir, 'review-metadata.json') : undefined;
  if (metadataPath) {
    await writeFile(metadataPath, `${JSON.stringify(options.metadata, null, 2)}\n`);
  }
  if (options.agent !== true) args.push('--no-orchestrator');
  if (options.mode) args.push('--mode', options.mode);
  if (options.clean) args.push('--clean');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: {
        ...process.env,
        ...(metadataPath ? { BB_REVIEW_METADATA_PATH: metadataPath } : {}),
        ...(options.agent === true ? {} : { DIFIT_DISABLE_ORCHESTRATOR: '1' }),
      },
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (metadataTempDir) void rm(metadataTempDir, { recursive: true, force: true });
      if (code === 0) resolve();
      else reject(new CliError(`review-ui exited with code ${code ?? 'unknown'}`));
    });

    child.stdin.write(options.diff);
    child.stdin.end();
  });
}

function resolveReviewUiEntrypoint(): string {
  if (process.env.BB_REVIEW_UI_ENTRYPOINT) {
    return process.env.BB_REVIEW_UI_ENTRYPOINT;
  }

  try {
    const packageJson = require.resolve('@bb-bitbucket-cli/review-ui/package.json');
    return join(dirname(packageJson), 'dist', 'cli', 'index.js');
  } catch {
    const currentFile = fileURLToPath(import.meta.url);
    return join(dirname(currentFile), '..', '..', 'review-ui', 'dist', 'cli', 'index.js');
  }
}
