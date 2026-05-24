#!/usr/bin/env node
import { Command } from 'commander';
import { registerApi } from './commands/api.js';
import { registerAuth } from './commands/auth.js';
import { registerPr } from './commands/pr.js';
import { registerRepo } from './commands/repo.js';
import { CliError } from './errors.js';

const program = new Command();

program
  .name('bb')
  .description('A GitHub CLI-inspired command line interface for Bitbucket Cloud')
  .version('0.1.0');

registerAuth(program);
registerApi(program);
registerRepo(program);
registerPr(program);

program.showHelpAfterError();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
