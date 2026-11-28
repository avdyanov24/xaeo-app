import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as reports from '../../src/server/repositories/report-repository.js';
import * as scans from '../../src/server/repositories/scan-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { createScan } from '../../src/server/services/scans/scan-state.js';

let db;
let ws;
let other;
let clientId;
let scanId;

beforeEach(() => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Mine');
  other = workspaces.insertWorkspace(db, 'Theirs');
  clientId = clients.insertClient(db, { workspaceId: ws, name: 'Acme', domain: 'acme.test' });
  scanId = scans.insertScan(db, {
    workspaceId: ws,
    clientId,
    scan: createScan({ total: 2, now: 0 }),
  });
});

describe('report repository', () => {
  it('saves a report and reads it back with its options as booleans', () => {
    const id = reports.insertReport(db, {
      workspaceId: ws,
      clientId,
      scanId,
      type: 'fix',
      includeAnswers: true,
    });
    const report = reports.findReport(db, ws, id);
    assert.equal(report.type, 'fix');
    assert.equal(report.scanId, scanId);
    assert.equal(report.includeAnswers, true);
    assert.equal(report.includeEstimates, false);
    assert.equal(report.createdBy, null);
  });

  it("lists a client's reports newest first", () => {
    const first = reports.insertReport(db, { workspaceId: ws, clientId, scanId, type: 'fix' });
    const second = reports.insertReport(db, {
      workspaceId: ws,
      clientId,
      scanId,
      type: 'progress',
    });
    assert.deepEqual(
      reports.listReports(db, ws, clientId).map((r) => r.id),
      [second, first],
    );
  });

  it('never finds or lists a report from another workspace', () => {
    const id = reports.insertReport(db, { workspaceId: ws, clientId, scanId, type: 'fix' });
    assert.equal(reports.findReport(db, other, id), undefined);
    assert.deepEqual(reports.listReports(db, other, clientId), []);
  });

  it('rejects a report type the page does not know', () => {
    assert.throws(() =>
      reports.insertReport(db, { workspaceId: ws, clientId, scanId, type: 'weekly' }),
    );
  });

  it('is deleted with its client', () => {
    const id = reports.insertReport(db, { workspaceId: ws, clientId, scanId, type: 'fix' });
    db.prepare('DELETE FROM clients WHERE id = ?').run(clientId);
    assert.equal(reports.findReport(db, ws, id), undefined);
  });
});
