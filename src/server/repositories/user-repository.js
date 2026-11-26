/** SQL for the `users` table. Emails are compared case-insensitively (COLLATE NOCASE). */

const COLUMNS = 'id, email, name, role, password_hash AS passwordHash, created_at AS createdAt';

/** @returns {{ id: number, email: string, name: string, role: string, passwordHash: string, createdAt: string } | undefined} */
export function findUserByEmail(db, email) {
  return db.prepare(`SELECT ${COLUMNS} FROM users WHERE email = ?`).get(email);
}

/** @returns the same user shape as `findUserByEmail`, or undefined when the id is unknown. */
export function findUserById(db, id) {
  return db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id);
}

/** @returns {number} the new user's id */
export function insertUser(db, { email, name, passwordHash, role = 'user' }) {
  const result = db
    .prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(email, name, passwordHash, role);
  return Number(result.lastInsertRowid);
}

/** Replaces a user's stored hash, for example when `needsRehash` says the parameters are outdated. */
export function updatePasswordHash(db, id, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}
