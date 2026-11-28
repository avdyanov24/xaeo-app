import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import { runSeeds } from '../../src/server/db/seed/index.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { exportWorkspace } from '../../src/server/services/workspace-export.js';

const NOW = Date.parse('2026-11-28T12:00:00Z');

describe('workspace export', () => {
  it('nests each client with its questions, scans, answers and fixes', async () => {
    const db = openDatabase(':memory:');
    await runSeeds(db);
    const doc = exportWorkspace(db, 1, NOW);
    assert.equal(doc.exportedAt, '2026-11-28T12:00:00.000Z');
    assert.equal(doc.workspace.name, 'Brightline Digital');
    assert.equal(doc.members.length, 2);
    const [northside] = doc.clients;
    assert.equal(northside.name, 'Northside Plumbing');
    assert.equal(northside.questions.length, 5);
    assert.equal(northside.scans.length, 1);
    assert.equal(northside.scans[0].answers.length, 10);
    assert.equal(northside.fixes.length, 4);
  });

  it('drops the ids that only said where a row hangs in the document', async () => {
    const db = openDatabase(':memory:');
    await runSeeds(db);
    const [northside] = exportWorkspace(db, 1, NOW).clients;
    assert.equal('clientId' in northside.questions[0], false);
    assert.equal('clientId' in northside.scans[0], false);
    assert.equal('scanId' in northside.scans[0].answers[0], false);
    assert.equal('clientId' in northside.fixes[0], false);
  });

  it('links every fix to the answers that justify it', async () => {
    const db = openDatabase(':memory:');
    await runSeeds(db);
    const [northside] = exportWorkspace(db, 1, NOW).clients;
    const answerIds = new Set(northside.scans[0].answers.map((answer) => answer.id));
    for (const fix of northside.fixes) {
      assert.ok(Array.isArray(fix.answerIds));
      for (const id of fix.answerIds) assert.ok(answerIds.has(id));
    }
  });

  it('exports an empty workspace as empty lists', () => {
    const db = openDatabase(':memory:');
    const id = workspaces.insertWorkspace(db, 'Empty');
    const doc = exportWorkspace(db, id, NOW);
    assert.deepEqual(doc.clients, []);
    assert.deepEqual(doc.members, []);
  });

  it('never carries rows from another workspace', () => {
    const db = openDatabase(':memory:');
    const mine = workspaces.insertWorkspace(db, 'Mine');
    const theirs = workspaces.insertWorkspace(db, 'Theirs');
    clients.insertClient(db, { workspaceId: theirs, name: 'Hidden', domain: 'hidden.test' });
    assert.deepEqual(exportWorkspace(db, mine, NOW).clients, []);
  });

  it('never includes password hashes or session tokens', async () => {
    const db = openDatabase(':memory:');
    await runSeeds(db);
    const text = JSON.stringify(exportWorkspace(db, 1, NOW));
    assert.doesNotMatch(text, /password|scrypt|token/i);
  });
});
