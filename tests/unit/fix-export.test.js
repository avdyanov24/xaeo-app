import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as fixes from '../../src/server/repositories/fix-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { CSV_COLUMNS, createFixExportService } from '../../src/server/services/fixes/fix-export.js';
import { addSampleClient } from '../../src/server/services/sample-client.js';

let db;
let ws;
let clientId;
let service;

/** Splits a CSV body into records and fields (RFC 4180), enough to read back what the writer wrote. */
function parse(text) {
  const rows = [[]];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') ((cell += '"'), i++);
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') (rows.at(-1).push(cell), (cell = ''));
    else if (c === '\r' && text[i + 1] === '\n')
      (rows.at(-1).push(cell), (cell = ''), rows.push([]), i++);
    else cell += c;
  }
  return rows.filter((row) => row.length);
}

beforeEach(async () => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Brightline Digital');
  ({ id: clientId } = await addSampleClient(db, ws));
  service = createFixExportService({ db });
});

const exported = (options) => parse(service.csv(ws, clientId, options).body.replace(/^\uFEFF/, ''));

describe('fix CSV export', () => {
  it('writes a header and one record per fix, with Fix ID first', () => {
    const rows = exported();
    assert.deepEqual(rows[0], [...CSV_COLUMNS]);
    assert.equal(rows.length, 5);
    assert.deepEqual(
      rows.slice(1).map((row) => row[0]),
      ['1', '2', '3', '4'],
    );
    const [, first] = rows;
    assert.equal(first[2], 'Northside Plumbing');
    assert.equal(first[5], 'Schema');
    assert.equal(first[6], 'ChatGPT, Claude');
    assert.equal(first[9], 'Done');
    assert.ok(first[11].includes('"@type": "Plumber"'), 'multi-line code with quotes survives');
  });

  it('starts with a byte order mark, ends records with CRLF, and names the file after the client', () => {
    const { body, filename } = service.csv(ws, clientId);
    assert.ok(body.startsWith('\uFEFFFix ID,Title,'));
    assert.ok(body.endsWith('\r\n'));
    assert.equal(filename, 'Northside Plumbing fixes.csv');
  });

  it('keeps a filename free of characters that could break the header', async () => {
    db.prepare('UPDATE clients SET name = \'Odd "name"\r\nX; y/z\' WHERE id = ?').run(clientId);
    assert.equal(service.csv(ws, clientId).filename, 'Odd nameX yz fixes.csv');
  });

  it('defuses a title that a spreadsheet would run as a formula', () => {
    fixes.insertFix(db, {
      workspaceId: ws,
      clientId,
      title: '=HYPERLINK("http://evil.test")',
      type: 'copy',
      impact: 'Low',
      evidence: 'Weak',
      url: 'https://northsideplumbing.co.uk/',
      engines: [],
      why: '-2+3',
      code: '@SUM(1)',
      lang: 'text',
      verify: 'ok',
    });
    const last = exported().at(-1);
    assert.equal(last[1], `'=HYPERLINK("http://evil.test")`);
    assert.equal(last[10], "'-2+3");
    assert.equal(last[11], "'@SUM(1)");
  });

  it('tracks each fix as sent, then changed after an edit, and only=new skips the sent ones', () => {
    assert.deepEqual(service.handoffs(ws, clientId), { handoffs: [] });
    assert.equal(exported({ onlyNew: true }).length, 5, 'nothing exported yet, so all are new');

    assert.deepEqual(service.recordHandoffs(ws, clientId, ['1', '2']), { recorded: 2 });
    const states = Object.fromEntries(
      service.handoffs(ws, clientId).handoffs.map((h) => [h.fixId, h.csv.state]),
    );
    assert.deepEqual(states, { 1: 'sent', 2: 'sent' });
    assert.deepEqual(
      exported({ onlyNew: true })
        .slice(1)
        .map((row) => row[0]),
      ['3', '4'],
    );

    fixes.setStatus(db, ws, 2, { status: 'done', doneAt: '2026-11-27T10:00:00.000Z' });
    const after = Object.fromEntries(
      service.handoffs(ws, clientId).handoffs.map((h) => [h.fixId, h.csv]),
    );
    assert.equal(after[1].state, 'sent');
    assert.equal(after[2].state, 'changed');
    assert.equal(after[2].count, 1);
    assert.deepEqual(
      exported({ onlyNew: true })
        .slice(1)
        .map((row) => row[0]),
      ['2', '3', '4'],
    );

    service.recordHandoffs(ws, clientId, ['2']);
    const again = service.handoffs(ws, clientId).handoffs.find((h) => h.fixId === '2');
    assert.deepEqual([again.csv.state, again.csv.count], ['sent', 2]);
  });

  it('records a fix once per call even when its id is repeated', () => {
    assert.deepEqual(service.recordHandoffs(ws, clientId, ['3', '3']), { recorded: 1 });
    assert.equal(service.handoffs(ws, clientId).handoffs[0].csv.count, 1);
  });

  it('records nothing when any id is not this client’s fix', () => {
    assert.throws(() => service.recordHandoffs(ws, clientId, ['1', '999']), { status: 404 });
    assert.deepEqual(service.handoffs(ws, clientId), { handoffs: [] });
  });

  it('answers 404 for a client in another workspace', () => {
    const other = workspaces.insertWorkspace(db, 'Other Agency');
    assert.throws(() => service.csv(other, clientId), { status: 404 });
    assert.throws(() => service.handoffs(other, clientId), { status: 404 });
    assert.throws(() => service.recordHandoffs(other, clientId, ['1']), { status: 404 });
  });
});
