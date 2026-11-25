import { readJson } from '../http/body.js';
import { unauthorized, validationFailed } from '../lib/errors.js';
import { validate } from '../lib/validate.js';

const EMAIL = { type: 'email', required: true, max: 254 };

const SIGNUP = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  email: EMAIL,
  // Checked by checkNewPassword: length is the rule that matters, and the cap keeps hashing bounded.
  password: { type: 'raw', required: true },
  workspaceName: { type: 'string', required: true, min: 1, max: 100 },
};

const LOGIN = {
  email: EMAIL,
  password: { type: 'raw', required: true },
};

/** Sign-up, sign-in, sign-out and the current session. */
export function registerAuthRoutes(router, { auth, sessionHttp }) {
  router.post('/api/signup', async (ctx) => {
    const input = validate(SIGNUP, await readJson(ctx.req));
    checkNewPassword(input.password);
    const result = await auth.signup(input);
    sessionHttp.setSessionCookie(ctx.res, result);
    return { status: 201, body: sessionBody(result.session) };
  });

  router.post('/api/login', async (ctx) => {
    const input = validate(LOGIN, await readJson(ctx.req));
    if (typeof input.password !== 'string') throw unauthorized('Email or password is incorrect.');
    // Signing in again replaces any session this browser already had.
    auth.logout(sessionHttp.readToken(ctx.req));
    const result = await auth.login(input);
    sessionHttp.setSessionCookie(ctx.res, result);
    return sessionBody(result.session);
  });

  router.post('/api/logout', (ctx) => {
    auth.logout(sessionHttp.readToken(ctx.req));
    sessionHttp.clearSessionCookie(ctx.res);
  });

  router.get(
    '/api/session',
    sessionHttp.requireUser((ctx) => sessionBody(ctx.session)),
  );
}

/** What the browser learns about a session: never the token, never the password hash. */
const sessionBody = ({ user, workspace }) => ({ user, workspace });

/** Passwords are raw input (never trimmed): every character the user typed counts. */
function checkNewPassword(password) {
  let message;
  if (typeof password !== 'string') message = 'must be a string';
  else if (password.length < 10) message = 'must be at least 10 characters';
  else if (password.length > 200) message = 'must be at most 200 characters';
  if (message) throw validationFailed([{ field: 'password', message }]);
}
