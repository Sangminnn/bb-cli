import { Command } from 'commander';
import { configPath, hasCredentials, removeConfig, saveCredentials } from '../config/credentials.js';
import { prompt } from '../prompt.js';

export function registerAuth(program: Command): void {
  const auth = program.command('auth').description('Authenticate with Bitbucket Cloud');

  auth.command('login')
    .description('Store Bitbucket Cloud username and app password/API token')
    .option('-u, --username <username>', 'Bitbucket username')
    .option('-p, --password <password>', 'Bitbucket app password or API token')
    .action(async (options: { username?: string; password?: string }) => {
      const username = options.username ?? await prompt('Bitbucket username');
      const appPassword = options.password ?? await prompt('Bitbucket app password/API token', { silent: true });
      await saveCredentials({ username, appPassword });
      console.log(`Logged in as ${username}. Credentials stored at ${configPath()}.`);
    });

  auth.command('status')
    .description('Show authentication status')
    .action(async () => {
      const ok = await hasCredentials();
      if (ok) {
        console.log('Logged in to Bitbucket Cloud.');
      } else {
        console.log('Not logged in. Run `bb auth login`.');
        process.exitCode = 1;
      }
    });

  auth.command('logout')
    .description('Remove stored credentials')
    .action(async () => {
      await removeConfig();
      console.log('Logged out.');
    });
}
