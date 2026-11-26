import * as answers from '../repositories/answer-repository.js';
import * as clients from '../repositories/client-repository.js';
import { buildStats } from './stats.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The clients whose next weekly rescan is the soonest, counted by the day it falls on. */
function nextRescan(due) {
  if (!due.length) return { nextRescan: null, nextRescanCount: 0 };
  const first = due.reduce((soonest, at) => (at < soonest ? at : soonest));
  const day = Math.floor(Date.parse(first) / DAY_MS);
  return {
    nextRescan: first,
    nextRescanCount: due.filter((at) => Math.floor(Date.parse(at) / DAY_MS) === day).length,
  };
}

/**
 * The numbers across a workspace's clients for the clients list. The sample client is left out so
 * example numbers are never shown as the agency's own; with only the sample client nothing counts
 * as scanned and the web app hides the block.
 * @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number }} deps
 */
export function createStatsService({ db, now = Date.now }) {
  return {
    /** @param {number} workspaceId */
    forWorkspace(workspaceId) {
      const own = clients.listClients(db, workspaceId).filter((client) => !client.sample);
      return {
        ...buildStats(answers.listEngineTotals(db, workspaceId), now()),
        sampleExcluded: true,
        weeklyAggregation: {
          description:
            'Each week adds up every client’s latest scan to that point. Clients, questions and engine coverage can differ between weeks, so this is a description and not a controlled comparison or proof of fix effects.',
        },
        ...nextRescan(own.map((client) => client.nextRunAt).filter(Boolean)),
        rescansPaused: false,
      };
    },
  };
}
