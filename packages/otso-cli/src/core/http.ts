/**
 * Small fetch wrapper for API connectors: JSON in/out, retries with backoff
 * on 429 and 5xx (honouring Retry-After), and errors that say which service
 * and status failed without echoing credentials.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string
  ) {
    super(`HTTP ${status} from ${new URL(url).host}${new URL(url).pathname}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  retries?: number;
  /** Treat these statuses as success and return null instead of parsing. */
  emptyOk?: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function request(url: string, opts: RequestOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 4;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        body: opts.body,
        headers: { 'User-Agent': 'otso-cli', Accept: 'application/json', ...opts.headers },
      });
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    return res;
  }
}

export async function getJson<T = any>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request(url, opts);
  if (opts.emptyOk?.includes(res.status)) return null as T;
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
  return (await res.json()) as T;
}
