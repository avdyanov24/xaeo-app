import { createHash, randomBytes } from 'node:crypto';
import { transaction } from '../db/database.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { hashPassword, needsRehash, verifyPassword } from '../lib/password.js';
import * as sessions from '../repositories/session-repository.js';
import * as users from '../repositories/user-repository.js';
import * as workspaces from '../repositories/workspace-repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const INVALID_CREDENTIALS = 'Email or password is incorrect.';

/** The browser keeps the raw token; the database keeps only this hash. */
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/**
 * Sign-up, sign-in, sign-out and session lookup.
 * @param {{ db: import('node:sqlite').DatabaseSync, sessionTtlMs?: number, now?: () => number }} deps
 */
export function createAuthService({ db, sessionTtlMs = 14 * DAY_MS, now = Date.now }) {
  // Hash checked when the email is unknown, so a wrong email takes as long as a
  // wrong password and response times do not reveal which accounts exist.
  let decoyHash;
  const decoy = async () => (decoyHash ??= await hashPassword(randomBytes(16).toString('hex')));

  function startSession(userId, workspaceId) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now() + sessionTtlMs).toISOString();
    sessions.insertSession(db, { tokenHash: hashToken(token), userId, workspaceId, expiresAt });
    return { token, expiresAt, session: sessions.findSession(db, hashToken(token)) };
  }

  /**
   * Creates a user, their agency workspace (they become its owner) and a session.
   * @param {{ name: string, email: string, password: string, workspaceName: string }} input
   */
  async function signup({ name, email, password, workspaceName }) {
    if (users.findUserByEmail(db, email)) throw emailTaken();
    const passwordHash = await hashPassword(password);
    try {
      return transaction(db, () => {
        const userId = users.insertUser(db, { email, name, passwordHash });
        const workspaceId = workspaces.insertWorkspace(db, workspaceName);
        workspaces.insertMembership(db, { workspaceId, userId, role: 'owner' });
        return startSession(userId, workspaceId);
      });
    } catch (error) {
      // Two sign-ups with the same email can both pass the check above while the
      // password is hashing; the UNIQUE constraint settles the race.
      if (/UNIQUE constraint failed: users\.email/.test(error?.message)) throw emailTaken();
      throw error;
    }
  }

  /** @param {{ email: string, password: string }} input */
  async function login({ email, password }) {
    const user = users.findUserByEmail(db, email);
    if (!user) {
      await verifyPassword(password, await decoy());
      throw unauthorized(INVALID_CREDENTIALS);
    }
    if (!(await verifyPassword(password, user.passwordHash)))
      throw unauthorized(INVALID_CREDENTIALS);
    if (needsRehash(user.passwordHash))
      users.updatePasswordHash(db, user.id, await hashPassword(password));

    const membership = workspaces.findDefaultMembership(db, user.id);
    if (!membership) throw unauthorized('This account is not part of any workspace.');

    sessions.deleteExpiredSessions(db, new Date(now()).toISOString());
    return startSession(user.id, membership.workspaceId);
  }

  /** Ends a session. Unknown or missing tokens are ignored so sign-out always succeeds. */
  function logout(token) {
    if (token) sessions.deleteSession(db, hashToken(token));
  }

  /** @returns the session's user and workspace, or null when the token is missing, unknown or expired. */
  function getSession(token) {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const found = sessions.findSession(db, tokenHash);
    if (!found) return null;
    if (Date.parse(found.expiresAt) <= now()) {
      sessions.deleteSession(db, tokenHash);
      return null;
    }
    return found;
  }

  return { signup, login, logout, getSession };
}

const emailTaken = () => conflict('An account with this email already exists.');
