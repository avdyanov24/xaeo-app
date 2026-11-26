import { findWorkspaceByName } from '../../repositories/workspace-repository.js';
import { addSampleClient } from '../../services/sample-client.js';
import { SEED_WORKSPACE } from './accounts.js';

/**
 * Adds Northside Plumbing, the example client, to the Brightline Digital workspace. It needs the
 * accounts step to have run first. Running it again changes nothing.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Promise<string[]>} names of the clients created by this call
 */
export async function seedNorthside(db) {
  const workspace = findWorkspaceByName(db, SEED_WORKSPACE);
  if (!workspace) return [];
  const { created } = await addSampleClient(db, workspace.id);
  return created ? ['Northside Plumbing'] : [];
}
