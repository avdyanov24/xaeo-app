import { forbidden, unauthorized } from '../lib/errors.js';
import { parseCookies, serializeCookie } from './cookies.js';

export const SESSION_COOKIE = 'xaeo_session';

/**
 * Connects the auth service to HTTP: reads and writes the session cookie and
 * provides guards that wrap route handlers.
 * @param {{ auth: ReturnType<import('../services/auth-service.js').createAuthService>, config: { secureCookies: boolean } }} deps
 */
export function createSessionHttp({ auth, config }) {
  const cookieOptions = { httpOnly: true, secure: config.secureCookies, sameSite: 'Lax' };

  const readToken = (req) => parseCookies(req.headers.cookie)[SESSION_COOKIE];

  /** Sets the cookie for a session returned by `auth.signup` or `auth.login`. */
  function setSessionCookie(res, { token, expiresAt }) {
    const maxAgeSeconds = (Date.parse(expiresAt) - Date.now()) / 1000;
    res.setHeader(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAgeSeconds }),
    );
  }

  function clearSessionCookie(res) {
    res.setHeader(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, '', { ...cookieOptions, maxAgeSeconds: 0 }),
    );
  }

  /** The signed-in session for this request, or null. */
  const currentSession = (req) => auth.getSession(readToken(req));

  /** Wraps a handler so it only runs for a signed-in user; `ctx.session` is set for it. */
  const requireUser = (handler) => (ctx) => {
    const session = currentSession(ctx.req);
    if (!session) throw unauthorized();
    return handler({ ...ctx, session });
  };

  /** Like `requireUser`, and the user must also have the admin role. */
  const requireAdmin = (handler) =>
    requireUser((ctx) => {
      if (ctx.session.user.role !== 'admin') throw forbidden();
      return handler(ctx);
    });

  return {
    readToken,
    setSessionCookie,
    clearSessionCookie,
    currentSession,
    requireUser,
    requireAdmin,
  };
}
