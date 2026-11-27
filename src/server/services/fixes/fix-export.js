import { createHash } from 'node:crypto';
import { notFound } from '../../lib/errors.js';
import { transaction } from '../../db/database.js';
import * as clients from '../../repositories/client-repository.js';
import * as fixes from '../../repositories/fix-repository.js';
import { ENGINES } from '../engines/engine.js';
import { toCsv } from './csv.js';

/** The header of the exported file. "Fix ID" comes first: the web app reads it to record the handoff. */
export const CSV_COLUMNS = Object.freeze([
  'Fix ID',
  'Title',
  'Client',
  'Domain',
  'Page',
  'Type',
  'Engines',
  'Impact',
  'Evidence',
  'Status',
  'Why',
  'Draft change',
  'How to verify',
]);

const TYPE_NAMES = {
  jsonld: 'Schema',
  page: 'New page',
  listing: 'Listing',
  copy: 'On-page copy',
  crawler: 'Crawler access',
};
const STATUS_NAMES = { todo: 'To do', done: 'Done', wont: 'Won’t do' };

/** The only way a fix leaves Xaeo today is a CSV file a person downloads. */
const CHANNEL = 'csv';

/** One fix as a row of the file. */
function csvRow(fix, client) {
  return [
    String(fix.id),
    fix.title,
    client.name,
    client.domain,
    fix.url,
    TYPE_NAMES[fix.type] ?? fix.type,
    fix.engines.map((id) => ENGINES[id]?.name ?? id).join(', '),
    fix.impact,
    fix.evidence,
    STATUS_NAMES[fix.status] ?? fix.status,
    fix.why,
    fix.code,
    fix.verify,
  ];
}

/** Fingerprint of what a row says, so an edit after an export shows up as a change. */
const fingerprint = (row) => createHash('sha256').update(JSON.stringify(row)).digest('hex');

/** A name safe to put inside a quoted `filename="..."`: letters, digits, spaces, dots, dashes. */
const safeFilename = (name) => name.replace(/[^A-Za-z0-9 ._-]/g, '').trim();

/**
 * Handing fixes to someone who will do the work: the CSV file, and the record of which fixes were
 * in which export. Every method takes the workspace id first and passes it to the repositories.
 * @param {{ db: import('node:sqlite').DatabaseSync }} deps
 */
export function createFixExportService({ db }) {
  const mustFindClient = (workspaceId, clientId) => {
    const client = clients.findClient(db, workspaceId, clientId);
    if (!client) throw notFound('Client not found.');
    return client;
  };

  /**
   * Where each fix stands with the CSV channel: `new` (never exported, so absent from the map),
   * `sent` (exported, unchanged since) or `changed` (edited since the last export).
   */
  const csvStates = (workspaceId, client, list) => {
    const summary = fixes.summarizeHandoffs(db, workspaceId, client.id, CHANNEL);
    const states = new Map();
    for (const fix of list) {
      const handoff = summary.get(fix.id);
      if (!handoff) continue;
      states.set(fix.id, {
        state: handoff.contentHash === fingerprint(csvRow(fix, client)) ? 'sent' : 'changed',
        count: handoff.count,
        lastAt: handoff.lastAt,
      });
    }
    return states;
  };

  return {
    /**
     * The client's fixes as a CSV file. With `onlyNew`, only fixes never exported or changed since.
     * Reading the file records nothing; the page records the handoff once the download succeeded.
     * @returns {{ filename: string, body: string }}
     */
    csv(workspaceId, clientId, { onlyNew = false } = {}) {
      const client = mustFindClient(workspaceId, clientId);
      const list = fixes.listFixes(db, workspaceId, clientId);
      const states = onlyNew ? csvStates(workspaceId, client, list) : new Map();
      const rows = list
        .filter((fix) => !onlyNew || states.get(fix.id)?.state !== 'sent')
        .map((fix) => csvRow(fix, client));
      return {
        filename: `${safeFilename(client.name) || 'Client'} fixes.csv`,
        // The byte order mark makes Excel read the file as UTF-8.
        body: '\uFEFF' + toCsv([CSV_COLUMNS, ...rows]),
      };
    },

    /** @returns {{ handoffs: { fixId: string, csv: { state: 'sent' | 'changed', count: number, lastAt: string } }[] }} */
    handoffs(workspaceId, clientId) {
      const client = mustFindClient(workspaceId, clientId);
      const list = fixes.listFixes(db, workspaceId, clientId);
      return {
        handoffs: [...csvStates(workspaceId, client, list)].map(([fixId, state]) => ({
          fixId: String(fixId),
          csv: state,
        })),
      };
    },

    /**
     * Records that these fixes went into a CSV export, with what each said at the time.
     * @param {string[]} fixIds ids as the page has them
     * @returns {{ recorded: number }}
     * @throws 404 when any of the fixes is not this client's, in which case nothing is recorded
     */
    recordHandoffs(workspaceId, clientId, fixIds) {
      const client = mustFindClient(workspaceId, clientId);
      const byId = new Map(
        fixes.listFixes(db, workspaceId, clientId).map((fix) => [String(fix.id), fix]),
      );
      const wanted = [...new Set(fixIds)];
      const entries = wanted.map((id) => {
        const fix = byId.get(id);
        if (!fix) throw notFound('Fix not found.');
        return { fixId: fix.id, contentHash: fingerprint(csvRow(fix, client)) };
      });
      transaction(db, () => fixes.insertHandoffs(db, workspaceId, { channel: CHANNEL, entries }));
      return { recorded: entries.length };
    },
  };
}
