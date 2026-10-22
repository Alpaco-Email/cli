/**
 * client.ts: the Alpaco API (`https://<host>/api/v1`).
 *
 * A push never changes the live template: it becomes a pending change that
 * someone publishes in Alpaco. There is no publish call, by design.
 */

import type { Design, Json } from './types.ts';

export const DEFAULT_HOST = 'https://platform.alpaco.email';

export interface Me {
  user: { id: number; name: string; email: string };
  organizations: { id: string; name: string; role: string }[];
}

export interface TemplateSummary {
  id: number;
  name: string;
  organization: { id: string; name: string };
  version: number;
  updated_at: string;
  updated_by: { id: number; name: string } | null;
}

export interface PendingSummary {
  id: number;
  kind: 'design' | 'link_tracking' | string;
  status: PendingStatus;
  source: string | null;
  base_version: number;
  created_at: string;
  user: { id: number; name: string } | null;
  review_url: string;
}

export type PendingStatus = 'pending' | 'published' | 'rejected' | 'withdrawn' | 'outdated';

export interface PendingChange extends PendingSummary {
  review_note: string | null;
  reviewed_by: { id: number; name: string } | null;
  reviewed_at: string | null;
  published_version: number | null;
  outdated_reason: string | null;
}

export interface Template extends TemplateSummary {
  permissions: { read: boolean; write: boolean };
  editing_lock: { user_id: number; expires_at: string; user?: { full_name?: string }; is_mine?: boolean } | null;
  settings: { tags: string[]; teams: { id: number; name: string }[]; link_tracking: Json };
  design: Design;
  pending: PendingSummary[];
}

export interface TemplateVersion {
  version: number;
  created_at: string;
  user: { id: number; name: string } | null;
  source: string | null;
  approved_by: { id: number; name: string } | null;
  approved_at: string | null;
  design: Design;
}

export interface PushResult {
  status: 'pending';
  pending_id: number;
  review_url: string;
  base_version: number;
  message: string;
}

export interface DiffResult {
  template: { id: number; name: string };
  live_version: number;
  has_changes: boolean;
  changes: Json[];
  markdown: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface ClientOptions {
  host: string;
  token: string;
  fetch?: typeof fetch;
  /** Called before waiting out a 429. */
  onRateLimit?: (seconds: number) => void;
}

export class AlpacoClient {
  readonly host: string;
  private readonly token: string;
  private readonly fetch: typeof fetch;
  private readonly onRateLimit?: (seconds: number) => void;

  constructor({ host, token, fetch: fetchImpl = fetch, onRateLimit }: ClientOptions) {
    this.host = normaliseHost(host);
    this.token = token;
    this.fetch = fetchImpl;
    this.onRateLimit = onRateLimit;
  }

  me() {
    return this.request<{ data: Me }>('GET', '/me').then((r) => r.data);
  }

  templates(organizationId?: string) {
    const query = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : '';
    return this.request<{ data: TemplateSummary[] }>('GET', `/templates${query}`).then((r) => r.data);
  }

  template(id: number) {
    return this.request<{ data: Template }>('GET', `/templates/${id}`).then((r) => r.data);
  }

  version(id: number, version: number) {
    return this.request<{ data: TemplateVersion }>('GET', `/templates/${id}/versions/${version}`).then((r) => r.data);
  }

  diff(id: number, design: Design) {
    return this.request<{ data: DiffResult }>('POST', `/templates/${id}/diff`, { design }).then((r) => r.data);
  }

  /** Propose a design. `baseVersion` is always sent: left out, the API skips the 409 check. */
  pushDesign(id: number, design: Design, baseVersion: number) {
    return this.request<PushResult>('PUT', `/templates/${id}/design`, { design, base_version: baseVersion });
  }

  pending(id: number, pendingId: number) {
    return this.request<{ data: PendingChange }>('GET', `/templates/${id}/pending/${pendingId}`).then((r) => r.data);
  }

  withdraw(id: number, pendingId: number) {
    return this.request<{ data: PendingChange }>('DELETE', `/templates/${id}/pending/${pendingId}`).then((r) => r.data);
  }

  private async request<T>(method: string, path: string, body?: unknown, attempt = 1): Promise<T> {
    let res: Response;
    try {
      res = await this.fetch(`${this.host}/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError(0, `Could not reach ${this.host}: ${(err as Error).message}`);
    }

    if (res.status === 429 && attempt < 4) {
      const seconds = Number(res.headers.get('retry-after')) || 10;
      this.onRateLimit?.(seconds);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return this.request<T>(method, path, body, attempt + 1);
    }

    const textBody = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = textBody ? JSON.parse(textBody) : {};
    } catch {
      // Not JSON (an HTML error page, say): reported by status below.
    }
    if (res.ok) return parsed as T;
    throw new ApiError(res.status, errorMessage(res.status, parsed, this.host), parsed);
  }
}

function errorMessage(status: number, body: Record<string, unknown>, host: string): string {
  const said = typeof body.message === 'string' ? body.message
    : typeof body.error_description === 'string' ? body.error_description : '';
  switch (status) {
    case 401:
      return `Alpaco refused the token. Generate a new one on your Alpaco profile page (Personal access token) and run \`alpaco login\`.`;
    case 403:
      return said || 'You do not have permission to do that.';
    case 404:
      return said && !said.startsWith('The route') ? said : 'Not found, or you do not have access to it.';
    case 429:
      return 'Alpaco is rate limiting requests (60 a minute). Try again in a minute.';
    default:
      return said || `Alpaco answered ${status} from ${host}.`;
  }
}

/** Accept `platform.alpaco.email`, a full URL, or one ending in /api/v1. */
export function normaliseHost(host: string): string {
  let h = host.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  if (!/^https?:\/\//.test(h)) h = `https://${h}`;
  return h;
}
