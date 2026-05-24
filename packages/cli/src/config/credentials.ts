import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { Credentials, StoredConfig } from '../types.js';
import { CliError, isRecord } from '../errors.js';

export function configPath(): string {
  const base = process.env.BB_CONFIG_HOME ?? join(homedir(), '.config', 'bb-cli');
  return join(base, 'config.json');
}

export async function readConfig(): Promise<StoredConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return parsed as StoredConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function writeConfig(config: StoredConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export async function removeConfig(): Promise<void> {
  await rm(configPath(), { force: true });
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  const existing = await readConfig();
  await writeConfig({ ...existing, credentials });
}

export async function loadCredentials(): Promise<Credentials> {
  const envUsername = process.env.BITBUCKET_USERNAME;
  const envPassword = process.env.BITBUCKET_APP_PASSWORD ?? process.env.BITBUCKET_TOKEN;
  if (envUsername && envPassword) {
    return { username: envUsername, appPassword: envPassword };
  }

  const config = await readConfig();
  if (config.credentials?.username && config.credentials.appPassword) {
    return config.credentials;
  }

  throw new CliError('Not authenticated. Run `bb auth login` or set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD.');
}

export async function hasCredentials(): Promise<boolean> {
  try {
    await loadCredentials();
    return true;
  } catch {
    return false;
  }
}
