import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { createClientService } from '../../src/server/services/client-service.js';
import {
  createLifecycleService,
  GRACE_PERIOD_MS,
} from '../../src/server/services/lifecycle-service.js';
import { addSampleClient } from '../../src/server/services/sample-client.js';

const T0 = Date.parse('2026-11-27T10:00:00Z');

let db;
let ws;
let clientId;
let clock;
let lifecycle;

beforeEach(async () => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Mine');
  ({ id: clientId } = await addSampleClient(db, ws));
  clock = T0;
  lifecycle = createLifecycleService({ db, now: () => clock });
});

const archive = () => clients.setArchivedAt(db, ws, clientId, new Date(T0).toISOString());

describe('client deletion', () => {
  it('has nothing pending to begin with', () => {
    assert.deepEqual(lifecycle.get(ws, clientId), { deletion: null });
  });

  it('refuses to delete a client that is not archived', () => {
    assert.throws(() => lifecycle.requestDeletion(ws, clientId), { status: 409 });
    assert.deepEqual(lifecycle.get(ws, clientId), { deletion: null });
  });

  it('schedules the deletion a week after the request and keeps the first date when asked again', () => {
    archive();
    const { deletion } = lifecycle.requestDeletion(ws, clientId);
    assert.equal(deletion.requestedAt, new Date(T0).toISOString());
    assert.equal(deletion.executeAfter, new Date(T0 + GRACE_PERIOD_MS).toISOString());
    clock += 1000;
    assert.deepEqual(lifecycle.requestDeletion(ws, clientId), { deletion });
    assert.deepEqual(lifecycle.get(ws, clientId), { deletion });
  });

  it('cancels a pending deletion, and cancelling twice is harmless', () => {
    archive();
    lifecycle.requestDeletion(ws, clientId);
    assert.deepEqual(lifecycle.cancelDeletion(ws, clientId), { deletion: null });
    assert.deepEqual(lifecycle.cancelDeletion(ws, clientId), { deletion: null });
    assert.deepEqual(lifecycle.get(ws, clientId), { deletion: null });
  });

  it('cancels the pending deletion when the client is unarchived', () => {
    archive();
    lifecycle.requestDeletion(ws, clientId);
    createClientService({ db }).unarchive(ws, clientId);
    assert.deepEqual(lifecycle.get(ws, clientId), { deletion: null });
    assert.equal(clients.findClient(db, ws, clientId).archivedAt, null);
  });

  it('deletes the client with everything under it only once the week has passed', () => {
    archive();
    lifecycle.requestDeletion(ws, clientId);
    clock = T0 + GRACE_PERIOD_MS - 1;
    assert.equal(lifecycle.purgeDue(), 0);
    assert.ok(clients.findClient(db, ws, clientId));

    clock = T0 + GRACE_PERIOD_MS;
    assert.equal(lifecycle.purgeDue(), 1);
    assert.equal(clients.findClient(db, ws, clientId), undefined);
    for (const table of ['questions', 'scans', 'answers', 'fixes', 'fix_evidence'])
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
    assert.equal(lifecycle.purgeDue(), 0);
  });

  it('never deletes a client nobody asked to delete', () => {
    archive();
    clock = T0 + 10 * GRACE_PERIOD_MS;
    assert.equal(lifecycle.purgeDue(), 0);
    assert.ok(clients.findClient(db, ws, clientId));
  });

  it('answers 404 for a client in another workspace and leaves it alone', () => {
    archive();
    const other = workspaces.insertWorkspace(db, 'Other');
    for (const call of ['get', 'requestDeletion', 'cancelDeletion'])
      assert.throws(() => lifecycle[call](other, clientId), { status: 404 }, call);
    assert.deepEqual(lifecycle.get(ws, clientId), { deletion: null });
  });
});
