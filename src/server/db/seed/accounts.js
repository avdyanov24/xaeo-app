import { hashPassword } from '../../lib/password.js';
import * as users from '../../repositories/user-repository.js';
import * as workspaces from '../../repositories/workspace-repository.js';
import { transaction } from '../database.js';

/**
 * The test accounts listed in the README. The passwords are for local use only and are
 * published on purpose; `npm run db:seed` refuses to run in production.
 */
export const SEED_ACCOUNTS = Object.freeze([
  {
    email: 'user@brightline.test',
    name: 'Sample User',
    password: 'brightline-user-1',
    role: 'user',
    membership: 'owner',
  },
  {
    email: 'admin@brightline.test',
    name: 'Sample Admin',
    password: 'brightline-admin-1',
    role: 'admin',
    membership: 'member',
  },
]);

export const SEED_WORKSPACE = 'Brightline Digital';

/**
 * Creates the Brightline Digital workspace and its two accounts. Accounts that already
 * exist are left alone, so running it twice changes nothing.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Promise<string[]>} emails of the accounts created by this call
 */
export async function seedAccounts(db) {
  const missing = SEED_ACCOUNTS.filter((account) => !users.findUserByEmail(db, account.email));
  if (!missing.length) return [];
  // Hash first: scrypt is async and transaction() needs synchronous work.
  const hashes = await Promise.all(missing.map((account) => hashPassword(account.password)));

  return transaction(db, () => {
    const existing = db.prepare('SELECT id FROM workspaces WHERE name = ?').get(SEED_WORKSPACE);
    const workspaceId = existing?.id ?? workspaces.insertWorkspace(db, SEED_WORKSPACE);
    missing.forEach((account, i) => {
      const userId = users.insertUser(db, {
        email: account.email,
        name: account.name,
        passwordHash: hashes[i],
        role: account.role,
      });
      workspaces.insertMembership(db, { workspaceId, userId, role: account.membership });
    });
    return missing.map((account) => account.email);
  });
}
