import { execa } from 'execa';

/**
 * The browser half of an OAuth sign-in for API sources that need one
 * (Foursquare, Spotify). Serves http://127.0.0.1:<port>/callback for up to
 * 15 minutes, opens the service's consent page in the default browser, and
 * resolves with the authorization code it redirects back with. The developer
 * app must list that exact redirect URI.
 */

export const OAUTH_PORT = 8765;
export const redirectUri = (port = OAUTH_PORT) => `http://127.0.0.1:${port}/callback`;

export interface OAuthOptions {
  /** The consent page URL, already carrying client_id, redirect_uri and scope. */
  authorizeUrl: string;
  port?: number;
  timeoutMs?: number;
  /** Swappable in tests. */
  openBrowser?: (url: string) => Promise<unknown>;
  log?: (message: string) => void;
}

export async function waitForAuthorizationCode(opts: OAuthOptions): Promise<string> {
  const port = opts.port ?? OAUTH_PORT;
  const state = crypto.randomUUID();
  const url = new URL(opts.authorizeUrl);
  url.searchParams.set('state', state);

  let settle!: { resolve: (code: string) => void; reject: (err: Error) => void };
  const done = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));
  const page = (msg: string) => new Response(`<!doctype html><meta charset="utf-8"><title>otso</title><p>${msg}</p>`, { headers: { 'content-type': 'text/html' } });

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname !== '/callback') return new Response('Not found', { status: 404 });
      if (u.searchParams.get('state') !== state) return page('This sign-in link is out of date. Run otso auth again.');
      const error = u.searchParams.get('error');
      if (error) {
        settle.reject(new Error(`Sign-in was not completed (${error})`));
        return page('Sign-in was cancelled. You can close this tab.');
      }
      const code = u.searchParams.get('code');
      if (!code) return page('No authorization code came back.');
      settle.resolve(code);
      return page('Connected. You can close this tab and go back to the terminal.');
    },
  });
  const timer = setTimeout(() => settle.reject(new Error('Timed out waiting for the browser sign-in')), opts.timeoutMs ?? 15 * 60_000);
  try {
    opts.log?.(`Opening your browser to sign in. If it doesn't open, visit:\n${url}`);
    await (opts.openBrowser ?? ((u: string) => execa('open', [u])))(url.toString());
    opts.log?.(`Waiting for you to approve in the browser (listening on 127.0.0.1:${port}; keep this terminal open)…`);
    return await done;
  } finally {
    clearTimeout(timer);
    server.stop(true);
  }
}
