import { seedAccounts } from './accounts.js';

/**
 * Seed steps in the order they run. Each step is idempotent and returns a short list of
 * what it created. Later sample data (clients, questions, answers) is added as its own step.
 */
export const SEED_STEPS = [{ name: 'accounts', run: seedAccounts }];

/**
 * Fills a database with the seed data.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Promise<Record<string, string[]>>} what each step created
 */
export async function runSeeds(db, steps = SEED_STEPS) {
  const created = {};
  for (const step of steps) created[step.name] = await step.run(db);
  return created;
}
