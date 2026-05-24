import { Command } from 'commander';
import { BitbucketClient } from '../bitbucket/client.js';
import { loadCredentials } from '../config/credentials.js';
import { printJson } from '../format.js';

export function registerApi(program: Command): void {
  program.command('api')
    .description('Call the Bitbucket Cloud REST API')
    .argument('<path>', 'API path, for example /repositories/workspace/repo')
    .option('-X, --method <method>', 'HTTP method')
    .option('-f, --field <field...>', 'JSON field as key=value')
    .option('-F, --raw-field <field...>', 'Raw JSON field as key=value')
    .action(async (path: string, options: { method?: string; field?: string[]; rawField?: string[] }) => {
      const credentials = await loadCredentials();
      const client = new BitbucketClient(credentials);
      const body = buildBody(options.field ?? [], options.rawField ?? []);
      const result = await client.request(path, {
        method: options.method,
        body: Object.keys(body).length > 0 ? body : undefined,
      });
      printJson(result);
    });
}

function buildBody(fields: string[], rawFields: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    const [key, ...rest] = field.split('=');
    if (!key) continue;
    body[key] = rest.join('=');
  }
  for (const field of rawFields) {
    const [key, ...rest] = field.split('=');
    if (!key) continue;
    const raw = rest.join('=');
    try {
      body[key] = JSON.parse(raw);
    } catch {
      body[key] = raw;
    }
  }
  return body;
}
