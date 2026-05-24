import { createRequire } from 'node:module';
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
};

export async function openReviewUi(options: ReviewUiOptions): Promise<void> {
  const entrypoint = resolveReviewUiEntrypoint();
  const args = [entrypoint, '-'];
  if (options.agent !== true) args.push('--no-orchestrator');
  if (options.mode) args.push('--mode', options.mode);
  if (options.clean) args.push('--clean');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: {
        ...process.env,
        ...(options.agent === true ? {} : { DIFIT_DISABLE_ORCHESTRATOR: '1' }),
      },
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new CliError(`review-ui exited with code ${code ?? 'unknown'}`));
    });

    child.stdin.write(options.diff);
    child.stdin.end();
  });
}

function resolveReviewUiEntrypoint(): string {
  try {
    const packageJson = require.resolve('@bb-bitbucket-cli/review-ui/package.json');
    return join(dirname(packageJson), 'dist', 'cli', 'index.js');
  } catch {
    const currentFile = fileURLToPath(import.meta.url);
    return join(dirname(currentFile), '..', '..', 'review-ui', 'dist', 'cli', 'index.js');
  }
}
