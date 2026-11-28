import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { createStatsService } from '../../src/server/services/stats-service.js';

let db;
let workspaceId;
let stats;

beforeEach(() => {
  db = openDatabase(':memory:');
  workspaceId = workspaces.insertWorkspace(db, 'Brightline Digital');
  stats = createStatsService({ db, now: () => Date.parse('2026-11-28T12:00:00.000Z') });
});

const addClient = (name, fields = {}) =>
  clients.insertClient(db, { workspaceId, name, domain: `${name}.test`, ...fields });

describe('stats service', () => {
  it('reports nothing scanned and no rescan when the workspace has no clients', () => {
    const result = stats.forWorkspace(workspaceId);
    assert.equal(result.scanned, false);
    assert.equal(result.nextRescan, null);
    assert.equal(result.nextRescanCount, 0);
    assert.deepEqual(result.weeks, []);
  });

  it('says the sample client is left out and that weekly totals are descriptive', () => {
    const result = stats.forWorkspace(workspaceId);
    assert.equal(result.sampleExcluded, true);
    assert.equal(result.rescansPaused, false);
    assert.match(result.weeklyAggregation.description, /not a controlled comparison/);
  });

  it('picks the soonest rescan and counts the clients that fall on that day', () => {
    addClient('alpha', { nextRunAt: '2026-12-02T09:00:00.000Z' });
    addClient('beta', { nextRunAt: '2026-12-01T18:00:00.000Z' });
    addClient('gamma', { nextRunAt: '2026-12-01T07:30:00.000Z' });
    const result = stats.forWorkspace(workspaceId);
    assert.equal(result.nextRescan, '2026-12-01T07:30:00.000Z');
    assert.equal(result.nextRescanCount, 2);
  });

  it('ignores the sample client, clients without a rescan date and other workspaces', () => {
    const other = workspaces.insertWorkspace(db, 'Other Agency');
    addClient('sample', { sample: true, nextRunAt: '2026-11-29T09:00:00.000Z' });
    addClient('unscheduled');
    clients.insertClient(db, {
      workspaceId: other,
      name: 'elsewhere',
      domain: 'elsewhere.test',
      nextRunAt: '2026-11-30T09:00:00.000Z',
    });
    addClient('mine', { nextRunAt: '2026-12-03T09:00:00.000Z' });
    const result = stats.forWorkspace(workspaceId);
    assert.equal(result.nextRescan, '2026-12-03T09:00:00.000Z');
    assert.equal(result.nextRescanCount, 1);
  });

  it('leaves archived clients out of the next rescan', () => {
    const id = addClient('archived', { nextRunAt: '2026-11-29T09:00:00.000Z' });
    clients.setArchivedAt(db, workspaceId, id, '2026-11-28T08:00:00.000Z');
    assert.equal(stats.forWorkspace(workspaceId).nextRescan, null);
  });
});
