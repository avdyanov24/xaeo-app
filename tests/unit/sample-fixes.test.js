import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as fixes from '../../src/server/repositories/fix-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { createFixService } from '../../src/server/services/fixes/fix-service.js';
import { addSampleClient } from '../../src/server/services/sample-client.js';

let db;
let ws;
let service;

beforeEach(() => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Brightline Digital');
  service = createFixService({ db });
});

describe("Northside Plumbing's fixes", () => {
  it('has four fixes, the first already shipped, each linked to answers that miss the client', async () => {
    const { id } = await addSampleClient(db, ws);
    const { fixes: list } = service.list(ws, id);
    assert.deepEqual(
      list.map((fix) => fix.status),
      ['done', 'todo', 'todo', 'todo'],
    );
    assert.deepEqual(
      list.map((fix) => fix.type),
      ['jsonld', 'page', 'page', 'copy'],
    );
    for (const fix of list) {
      assert.equal(fix.gain, 1, fix.title);
      assert.ok(fix.evidenceAnswers.length > 0, fix.title);
      for (const answer of fix.evidenceAnswers) assert.equal(answer.label, 'Not mentioned');
    }
  });

  it('estimates 6 of 10 once all four are done, from a baseline of 2', async () => {
    const { id } = await addSampleClient(db, ws);
    assert.deepEqual(service.list(ws, id).estimate, { current: 2, total: 10, projected: 6 });
  });

  it('shows the shipped fix as awaiting a rescan, not as measured', async () => {
    const { id } = await addSampleClient(db, ws);
    const [shipped] = service.list(ws, id).fixes;
    assert.equal(shipped.status, 'done');
    assert.ok(shipped.doneAt);
    assert.equal(shipped.postDoneScan, false);
  });

  it('keeps the fixes in step with the evidence labels the Answers tab shows', async () => {
    const { id } = await addSampleClient(db, ws);
    const evidence = fixes.listEvidence(db, ws, id);
    assert.equal(evidence.size, 4);
    assert.equal([...evidence.values()].flat().length, 7);
  });

  it('adds nothing when the client already has fixes, and fills in a database that has none', async () => {
    const { id } = await addSampleClient(db, ws);
    await addSampleClient(db, ws);
    assert.equal(fixes.countFixes(db, ws, id).total, 4);

    db.prepare('DELETE FROM fixes').run();
    assert.deepEqual(await addSampleClient(db, ws), { id, created: false });
    assert.equal(fixes.countFixes(db, ws, id).total, 4);
  });

  it('gives each workspace its own fixes', async () => {
    const other = workspaces.insertWorkspace(db, 'Other Agency');
    const a = await addSampleClient(db, ws);
    const b = await addSampleClient(db, other);
    assert.equal(fixes.countFixes(db, ws, a.id).total, 4);
    assert.equal(fixes.countFixes(db, other, b.id).total, 4);
    assert.equal(fixes.countFixes(db, ws, b.id).total, 0);
  });
});
