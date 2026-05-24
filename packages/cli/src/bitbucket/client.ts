import { Credentials } from '../types.js';
import { CliError, isRecord } from '../errors.js';

export type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export class BitbucketClient {
  private readonly baseUrl = 'https://api.bitbucket.org/2.0';

  constructor(private readonly credentials: Credentials) {}

  async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = normalizedPath.startsWith('/2.0/')
      ? `https://api.bitbucket.org${normalizedPath}`
      : `${this.baseUrl}${normalizedPath}`;

    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.credentials.username}:${this.credentials.appPassword}`).toString('base64')}`,
      Accept: 'application/json',
      ...options.headers,
    };

    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const response = await fetch(url, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
    });

    const text = await response.text();
    const payload = parseMaybeJson(text);

    if (!response.ok) {
      const message = extractErrorMessage(payload) ?? `${response.status} ${response.statusText}`;
      throw new CliError(`Bitbucket API error: ${message}`, response.status === 401 ? 2 : 1);
    }

    return payload;
  }

  async requestText(path: string, options: RequestOptions = {}): Promise<string> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = normalizedPath.startsWith('/2.0/')
      ? `https://api.bitbucket.org${normalizedPath}`
      : `${this.baseUrl}${normalizedPath}`;

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.credentials.username}:${this.credentials.appPassword}`).toString('base64')}`,
        Accept: 'text/plain, text/x-diff, text/x-patch, */*',
        ...options.headers,
      },
    });

    const text = await response.text();
    if (!response.ok) {
      const payload = parseMaybeJson(text);
      const message = extractErrorMessage(payload) ?? `${response.status} ${response.statusText}`;
      throw new CliError(`Bitbucket API error: ${message}`, response.status === 401 ? 2 : 1);
    }
    return text;
  }
}

function parseMaybeJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const error = payload.error;
  if (isRecord(error)) {
    const message = error.message;
    if (typeof message === 'string') return message;
  }
  const message = payload.message;
  return typeof message === 'string' ? message : undefined;
}
