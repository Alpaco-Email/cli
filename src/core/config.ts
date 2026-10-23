/**
 * config.ts: where the CLI keeps the user's token.
 *
 * Personal access tokens never expire, so the file is readable by the user
 * only (0600, in a 0700 folder). In CI, ALPACO_TOKEN and ALPACO_HOST are used
 * instead and nothing is written.
 */

import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_HOST, normaliseHost } from './client.ts';
import { run } from './hint.ts';

interface Credentials {
  default?: string;
  hosts: Record<string, { token: string; email?: string }>;
}

export function configDir(): string {
  if (process.env.ALPACO_CONFIG_DIR) return process.env.ALPACO_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'alpaco');
}

const credentialsFile = () => join(configDir(), 'credentials.json');

async function readCredentials(): Promise<Credentials> {
  try {
    const parsed = JSON.parse(await readFile(credentialsFile(), 'utf8'));
    return { hosts: {}, ...parsed };
  } catch {
    return { hosts: {} };
  }
}

export async function saveToken(host: string, token: string, email?: string): Promise<string> {
  const h = normaliseHost(host);
  const creds = await readCredentials();
  creds.hosts[h] = { token, email };
  creds.default = h;
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(credentialsFile(), JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
  await chmod(credentialsFile(), 0o600);
  return credentialsFile();
}

/** Forget the token for `host`, or every token. Returns whether one was removed. */
export async function removeToken(host?: string): Promise<boolean> {
  const creds = await readCredentials();
  if (!host) {
    const had = Object.keys(creds.hosts).length > 0;
    await rm(credentialsFile(), { force: true });
    return had;
  }
  const h = normaliseHost(host);
  if (!creds.hosts[h]) return false;
  delete creds.hosts[h];
  if (creds.default === h) delete creds.default;
  await writeFile(credentialsFile(), JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
  return true;
}

export class NotLoggedIn extends Error {}

/**
 * The host and token to use. Host: --host, then ALPACO_HOST, then the
 * project's alpaco.json, then the host last logged in to. Token:
 * ALPACO_TOKEN, then the stored token for that host.
 */
export async function resolveAuth(opts: { host?: string; projectHost?: string } = {}) {
  const creds = await readCredentials();
  const host = normaliseHost(opts.host || process.env.ALPACO_HOST || opts.projectHost || creds.default || DEFAULT_HOST);
  const token = process.env.ALPACO_TOKEN || creds.hosts[host]?.token;
  if (!token) {
    throw new NotLoggedIn(`Not logged in to ${host}. Run \`${run('login')}\`, or set ALPACO_TOKEN.`);
  }
  return { host, token };
}

export async function defaultHost(): Promise<string> {
  return normaliseHost(process.env.ALPACO_HOST || (await readCredentials()).default || DEFAULT_HOST);
}
