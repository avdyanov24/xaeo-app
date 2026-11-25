# 0002. Server-side sessions in a cookie, passwords hashed with scrypt

- **Status:** Accepted
- **Date:** 2026-11-25

## Context

Xaeo needs sign-up, sign-in and sign-out for agency users, roles for a user and an admin, and every later query scoped to the signed-in user's workspace. The web app is served from the same origin as the API, and ADR 0001 keeps dependencies to the Node.js standard library where possible.

The usual options were signed tokens (JWTs) kept by the browser, or random session ids stored by the server. Password hashing could use bcrypt or argon2 from npm, or scrypt from `node:crypto`.

## Decision

- A session is a random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). The `sessions` table stores only its SHA-256 hash, the user, the workspace and an expiry (14 days by default, `SESSION_TTL_DAYS`).
- Every request looks its session up in SQLite. A session resolves only while the user is still a member of the workspace, so removing a member signs them out at once.
- Passwords are hashed with scrypt (N = 2^15, r = 8, p = 1, 16-byte salt). Each hash records its parameters, and a login with an older, weaker hash upgrades it.
- Login gives the same error, in about the same time, for an unknown email and a wrong password.
- Route handlers are protected by wrapping them in `requireUser()` or `requireAdmin()` from `src/server/http/session.js`.

## Consequences

- Sign-out and membership removal take effect immediately, which signed tokens cannot do without a deny list.
- A copied database cannot be used to sign in: it holds no raw tokens and no plain passwords.
- One indexed lookup per signed-in request; with SQLite in the same process this costs microseconds.
- Cross-site requests: `SameSite=Lax` stops other sites from sending the cookie on `POST`, and JSON bodies need a CORS preflight that the API never grants. If the API is ever opened to other origins, add explicit CSRF tokens.
- Not covered yet: rate limiting of login attempts, password reset and email verification. They need their own changes.
