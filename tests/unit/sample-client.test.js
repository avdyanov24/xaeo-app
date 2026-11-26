import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import { runSeeds } from '../../src/server/db/seed/index.js';
import * as answers from '../../src/server/repositories/answer-repository.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as questions from '../../src/server/repositories/question-repository.js';
import * as scans from '../../src/server/repositories/scan-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { addSampleClient } from '../../src/server/services/sample-client.js';

let db;
let ws;

beforeEach(() => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Brightline Digital');
});

describe('Northside Plumbing sample client', () => {
  it('adds the client with five questions and a finished scan of ten answers', async () => {
    const { id, created } = await addSampleClient(db, ws);
    assert.equal(created, true);

    const client = clients.findClient(db, ws, id);
    assert.equal(client.name, 'Northside Plumbing');
    assert.equal(client.domain, 'northsideplumbing.co.uk');
    assert.equal(client.city, 'Leeds');
    assert.equal(client.sample, true);

    assert.equal(questions.listQuestions(db, ws, id).length, 5);

    const [scan, ...older] = scans.listScans(db, ws, id);
    assert.equal(older.length, 0);
    assert.equal(scan.state, 'done');
    assert.equal(scan.completed, 10);
    assert.equal(scan.total, 10);
    assert.ok(scan.finishedAt);
  });

  it('names the client in 2 of the 10 answers, the baseline', async () => {
    const { id } = await addSampleClient(db, ws);
    const [scan] = scans.listScans(db, ws, id);
    assert.deepEqual(answers.scanTotals(db, ws, scan.id), { ok: 10, mentioned: 2, failed: 0 });

    const rows = answers.listAnswers(db, ws, scan.id);
    const named = rows.filter((a) => a.mentioned);
    assert.deepEqual(
      named.map((a) => [a.engine, a.questionText, a.position, a.label]),
      [
        ['claude', 'Who is the best emergency plumber in Leeds?', 2, 'Mentioned'],
        ['chatgpt', 'Who can unblock a drain in Leeds today?', 3, 'Cited'],
      ],
    );
    // ChatGPT recommends Rapid Flow and CityPipe on the hero question.
    const hero = rows.find(
      (a) => a.engine === 'chatgpt' && a.questionText.includes('best emergency'),
    );
    assert.deepEqual(hero.competitors, ['Rapid Flow', 'CityPipe']);
  });

  it('does nothing when the workspace already has its sample client', async () => {
    const first = await addSampleClient(db, ws);
    const again = await addSampleClient(db, ws);
    assert.deepEqual(again, { id: first.id, created: false });
    assert.equal(db.prepare('SELECT count(*) AS n FROM clients').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM answers').get().n, 10);
  });

  it('counts an archived sample client too, so it is restored and not duplicated', async () => {
    const first = await addSampleClient(db, ws);
    clients.setArchivedAt(db, ws, first.id, '2026-11-26T10:00:00.000Z');
    assert.deepEqual(await addSampleClient(db, ws), { id: first.id, created: false });
  });

  it('gives each workspace its own copy', async () => {
    const other = workspaces.insertWorkspace(db, 'Other Agency');
    const a = await addSampleClient(db, ws);
    const b = await addSampleClient(db, other);
    assert.notEqual(a.id, b.id);
    assert.equal(clients.listClients(db, ws).length, 1);
    assert.equal(clients.listClients(db, other).length, 1);
  });

  it('writes nothing when a scan cannot be stored', async () => {
    db.exec('DROP TABLE answers');
    await assert.rejects(addSampleClient(db, ws));
    assert.equal(db.prepare('SELECT count(*) AS n FROM clients').get().n, 0);
  });
});

describe('seed step', () => {
  it('adds Northside to Brightline Digital after the accounts and is safe to repeat', async () => {
    const created = await runSeeds(db);
    assert.deepEqual(created.northside, ['Northside Plumbing']);
    assert.deepEqual((await runSeeds(db)).northside, []);
    assert.equal(db.prepare('SELECT count(*) AS n FROM clients').get().n, 1);
  });

  it('skips quietly when there is no Brightline Digital workspace', async () => {
    const empty = openDatabase(':memory:');
    const { seedNorthside } = await import('../../src/server/db/seed/northside.js');
    assert.deepEqual(await seedNorthside(empty), []);
  });
});
