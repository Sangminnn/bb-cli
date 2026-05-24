import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export async function prompt(question: string, options?: { silent?: boolean; defaultValue?: string }): Promise<string> {
  if (options?.silent) {
    return promptSilent(question);
  }
  const rl = createInterface({ input, output });
  try {
    const suffix = options?.defaultValue ? ` (${options.defaultValue})` : '';
    const answer = await rl.question(`${question}${suffix}: `);
    return answer.trim() || options?.defaultValue || '';
  } finally {
    rl.close();
  }
}

async function promptSilent(question: string): Promise<string> {
  const mutableOutput = output as NodeJS.WriteStream & { muted?: boolean };
  mutableOutput.write(`${question}: `);
  mutableOutput.muted = true;
  const originalWrite = mutableOutput.write;
  mutableOutput.write = ((chunk: Uint8Array | string, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
    if (mutableOutput.muted) return true;
    return originalWrite.call(mutableOutput, chunk, encoding as BufferEncoding, callback);
  }) as typeof mutableOutput.write;

  const rl = createInterface({ input, output: mutableOutput });
  try {
    const answer = await rl.question('');
    mutableOutput.muted = false;
    mutableOutput.write('\n');
    return answer.trim();
  } finally {
    mutableOutput.muted = false;
    mutableOutput.write = originalWrite;
    rl.close();
  }
}
