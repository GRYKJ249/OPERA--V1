import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { SessionUser } from './auth.ts';

const PREFIX = '/gitea';
const GITEA_HOST = '127.0.0.1';
const GITEA_PORT = 3001;

function isGitHttpRequest(req: IncomingMessage, path: string): boolean {
  const repoPath = path.slice(PREFIX.length);
  if (!/^\/[^/]+\/[^/]+\.git\/(?:info\/refs|git-upload-pack|git-receive-pack)$/.test(repoPath)) return false;

  const service = new URL(req.url ?? '/', 'http://opera.local').searchParams.get('service');
  if (req.method === 'GET' && repoPath.endsWith('/info/refs') && service === 'git-upload-pack') return true;
  if (req.method === 'POST' && repoPath.endsWith('/git-upload-pack')) return true;
  return !!req.headers.authorization;
}

function safeHeader(value: string | null | undefined, limit = 200): string {
  return String(value ?? '').replace(/[\r\n\0-\x1f\x7f]/g, ' ').trim().slice(0, limit);
}

export function proxyGitea(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  user: SessionUser | null,
  requestInfo: { origin: string; clientIp?: string },
): Promise<void> {
  const isGitClient = isGitHttpRequest(req, path);
  if (!user && !isGitClient) {
    const returnTo = req.url?.startsWith(PREFIX) ? req.url : `${PREFIX}/`;
    res.writeHead(302, {
      Location: `/pages/login.html?returnTo=${encodeURIComponent(returnTo)}`,
      'Cache-Control': 'no-store',
    });
    res.end();
    return Promise.resolve();
  }

  const rawUrl = req.url ?? `${PREFIX}/`;
  const upstreamPath = rawUrl.replace(/^\/gitea(?=\/|\?|$)/, '') || '/';
  const headers: Record<string, string | string[] | undefined> = { ...req.headers };
  delete headers['x-webauth-user'];
  delete headers['x-webauth-email'];
  delete headers['x-webauth-fullname'];
  delete headers['x-webauth-admin'];

  const cookies = (req.headers.cookie ?? '')
    .split(/;\s*/)
    .filter((cookie) => cookie && !/^op_session=/i.test(cookie))
    .join('; ');
  if (cookies) headers.cookie = cookies;
  else delete headers.cookie;

  const forwardedHost = safeHeader(req.headers.host, 250);
  headers.host = forwardedHost || `${GITEA_HOST}:${GITEA_PORT}`;
  headers['x-forwarded-host'] = forwardedHost;
  headers['x-forwarded-proto'] = new URL(requestInfo.origin).protocol.slice(0, -1);
  headers['x-real-ip'] = safeHeader(requestInfo.clientIp ?? req.socket.remoteAddress, 100);
  headers['x-forwarded-for'] = safeHeader(requestInfo.clientIp ?? req.socket.remoteAddress, 100);

  if (user) {
    headers['x-webauth-user'] = `opera-${user.id}`;
    headers['x-webauth-email'] = safeHeader(user.email, 254);
    headers['x-webauth-fullname'] = safeHeader(user.displayName || user.email, 100);
  }

  return new Promise((resolve) => {
    const upstream = httpRequest({
      hostname: GITEA_HOST,
      port: GITEA_PORT,
      path: upstreamPath,
      method: req.method,
      headers,
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      upstreamRes.on('end', resolve);
    });

    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end('Gitea is starting or unavailable.');
      } else {
        res.end();
      }
      resolve();
    });

    req.pipe(upstream);
  });
}