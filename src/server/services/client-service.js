import { transaction } from '../db/database.js';
import { notFound, validationFailed } from '../lib/errors.js';
import * as answers from '../repositories/answer-repository.js';
import * as clients from '../repositories/client-repository.js';
import * as questions from '../repositories/question-repository.js';
import * as scans from '../repositories/scan-repository.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Reduces what a person types or pastes ("https://www.Northsideplumbing.co.uk/contact") to the bare
 * host name the database stores.
 * @param {string} input
 * @returns {string} the host name, or '' when the input is not a usable one
 */
export function normalizeDomain(input) {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
}

/**
 * The client as the web app lists it: its details, how many questions it asks, the scan in
 * progress (if any) and the totals of the latest finished scan.
 */
function summarize(db, client) {
  const active = scans.findActiveScan(db, client.workspaceId, client.id);
  const latest = scans
    .listScans(db, client.workspaceId, client.id)
    .find((scan) => scan.state === 'done');
  return {
    id: client.id,
    name: client.name,
    domain: client.domain,
    type: client.type,
    city: client.city,
    country: client.country,
    sample: client.sample,
    status: client.archivedAt ? 'archived' : 'active',
    weekly: client.nextRunAt !== null,
    nextRunAt: client.nextRunAt,
    questions: questions.listQuestions(db, client.workspaceId, client.id).length,
    runningId: active?.id ?? null,
    latest: latest
      ? {
          id: latest.id,
          number: latest.number,
          finishedAt: latest.finishedAt,
          ...answers.scanTotals(db, client.workspaceId, latest.id),
        }
      : null,
  };
}

/**
 * Clients, their questions and the archive. Every method takes the workspace id first and passes it
 * to the repositories, so one agency never reads or changes another agency's clients.
 * @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number }} deps
 */
export function createClientService({ db, now = Date.now }) {
  const mustFind = (workspaceId, id) => {
    const client = clients.findClient(db, workspaceId, id);
    if (!client) throw notFound('Client not found.');
    return client;
  };

  const detail = (workspaceId, id) => {
    const client = mustFind(workspaceId, id);
    return { ...summarize(db, client), running: scans.findActiveScan(db, workspaceId, id) ?? null };
  };

  return {
    /** @returns {{ clients: object[], archivedCount: number }} */
    list(workspaceId, { archived = false } = {}) {
      return {
        clients: clients.listClients(db, workspaceId, { archived }).map((c) => summarize(db, c)),
        archivedCount: clients.countArchivedClients(db, workspaceId),
      };
    },

    /** One client with its running scan, if there is one. */
    get: detail,

    /**
     * Adds a client with its starting questions. The weekly rescan is on, due a week from now.
     * @param {{ name: string, domain: string, type: string, city: string, country: string, questions: { text: string, intent: string }[] }} input
     * @returns {{ id: number }}
     * @throws 422 when the domain is not a host name
     */
    create(workspaceId, { questions: starters, ...details }) {
      const domain = normalizeDomain(details.domain);
      if (!domain)
        throw validationFailed([{ field: 'domain', message: 'must be a website address' }]);
      return transaction(db, () => {
        const id = clients.insertClient(db, {
          workspaceId,
          ...details,
          domain,
          nextRunAt: new Date(now() + WEEK_MS).toISOString(),
        });
        for (const { text, intent } of starters)
          questions.insertQuestion(db, { workspaceId, clientId: id, text, intent });
        return { id };
      });
    },

    /**
     * Changes a client's details. `weekly` switches the weekly rescan on (due in a week) or off.
     * @returns the client as `get` returns it
     */
    update(workspaceId, id, { weekly, domain, ...fields }) {
      const client = mustFind(workspaceId, id);
      const changes = { ...fields };
      if (domain !== undefined) {
        changes.domain = normalizeDomain(domain);
        if (!changes.domain)
          throw validationFailed([{ field: 'domain', message: 'must be a website address' }]);
      }
      if (weekly !== undefined && !client.archivedAt)
        changes.nextRunAt = weekly ? new Date(now() + WEEK_MS).toISOString() : null;
      clients.updateClient(db, workspaceId, id, changes);
      return detail(workspaceId, id);
    },

    /** Archiving also turns the weekly rescan off, so nothing runs for a hidden client. */
    archive(workspaceId, id) {
      mustFind(workspaceId, id);
      transaction(db, () => {
        clients.setArchivedAt(db, workspaceId, id, new Date(now()).toISOString());
        clients.updateClient(db, workspaceId, id, { nextRunAt: null });
      });
    },

    unarchive(workspaceId, id) {
      mustFind(workspaceId, id);
      clients.setArchivedAt(db, workspaceId, id, null);
    },
  };
}
