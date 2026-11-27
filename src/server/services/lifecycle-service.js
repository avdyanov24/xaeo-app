import { transaction } from '../db/database.js';
import { conflict, notFound } from '../lib/errors.js';
import * as clients from '../repositories/client-repository.js';

/** How long a client stays archived and readable between the request and the deletion. */
export const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deleting a client is a request first and a deletion a week later, so a mistake can be undone.
 * Every method takes the workspace id first; who may ask (owners) is decided by the routes.
 * @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number }} deps
 */
export function createLifecycleService({ db, now = Date.now }) {
  const deletionOf = (workspaceId, clientId) => {
    const found = clients.findDeletion(db, workspaceId, clientId);
    if (!found) throw notFound('Client not found.');
    return found.requestedAt ? found : null;
  };

  return {
    /** @returns {{ deletion: { requestedAt: string, executeAfter: string } | null }} */
    get(workspaceId, clientId) {
      return { deletion: deletionOf(workspaceId, clientId) };
    },

    /**
     * Schedules the deletion of an archived client. Asking again keeps the first date, so a repeated
     * request never pushes the deletion back.
     * @throws 404 for a client in another workspace; 409 when the client is not archived
     */
    requestDeletion(workspaceId, clientId) {
      const existing = deletionOf(workspaceId, clientId);
      if (existing) return { deletion: existing };
      if (!clients.findClient(db, workspaceId, clientId).archivedAt)
        throw conflict('Archive the client before asking to delete it.');
      const deletion = {
        requestedAt: new Date(now()).toISOString(),
        executeAfter: new Date(now() + GRACE_PERIOD_MS).toISOString(),
      };
      clients.setDeletion(db, workspaceId, clientId, deletion);
      return { deletion };
    },

    /** Cancels a pending deletion. Safe to repeat. */
    cancelDeletion(workspaceId, clientId) {
      deletionOf(workspaceId, clientId);
      clients.setDeletion(db, workspaceId, clientId, { requestedAt: null, executeAfter: null });
      return { deletion: null };
    },

    /**
     * Deletes every client whose grace period has ended, in all workspaces. Run at start-up and
     * on a timer; it is not reachable from a request.
     * @returns {number} how many clients were deleted
     */
    purgeDue() {
      const due = clients.listDueForDeletion(db, new Date(now()).toISOString());
      for (const { id, workspaceId } of due)
        transaction(db, () => clients.deleteClient(db, workspaceId, id));
      return due.length;
    },
  };
}
