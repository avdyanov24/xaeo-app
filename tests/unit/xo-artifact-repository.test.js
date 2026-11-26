import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as artifacts from '../../src/server/repositories/xo-artifact-repository.js';

function setup() {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO workspaces (id, name) VALUES (1, 'A'), (2, 'B');
    INSERT INTO clients (id, workspace_id, name, domain) VALUES (1, 1, 'One', 'one.test'), (2, 2, 'Two', 'two.test');
  `);
  return db;
}

const DRAFT = {
  workspaceId: 1,
  clientId: 1,
  kind: 'llms_txt',
  title: 'llms.txt for one.test',
  code: '# One',
  contentHash: 'h1',
  notes: ['Checked against the home page'],
  claims: ['Opening hours'],
};

describe('xo artifact repository', () => {
  it('stores a draft at version 1 with its notes and claims as lists', () => {
    const db = setup();
    const id = artifacts.insertArtifact(db, DRAFT);
    const draft = artifacts.findArtifact(db, 1, id);
    assert.equal(draft.version, 1);
    assert.equal(draft.state, 'pending');
    assert.deepEqual(draft.notes, DRAFT.notes);
    assert.deepEqual(draft.claims, DRAFT.claims);
    assert.equal(artifacts.listVersions(db, id).length, 1);
  });

  it('never returns a draft from another workspace', () => {
    const db = setup();
    const id = artifacts.insertArtifact(db, DRAFT);
    assert.equal(artifacts.findArtifact(db, 2, id), undefined);
    assert.deepEqual(artifacts.listArtifacts(db, 2), []);
  });

  it('lists drafts newest first and can narrow to one client', () => {
    const db = setup();
    db.exec(
      "INSERT INTO clients (id, workspace_id, name, domain) VALUES (3, 1, 'Three', 'three.test')",
    );
    const first = artifacts.insertArtifact(db, DRAFT);
    const second = artifacts.insertArtifact(db, { ...DRAFT, clientId: 3, title: 'Second' });
    assert.deepEqual(
      artifacts.listArtifacts(db, 1).map((a) => a.id),
      [second, first],
    );
    assert.deepEqual(
      artifacts.listArtifacts(db, 1, { clientId: 1 }).map((a) => a.id),
      [first],
    );
  });

  it('adds a version, which puts an approved draft back to pending', () => {
    const db = setup();
    const id = artifacts.insertArtifact(db, DRAFT);
    artifacts.setArtifactState(db, 1, id, 'approved');
    const version = artifacts.addVersion(db, 1, id, { code: '# One, edited', contentHash: 'h2' });
    assert.equal(version, 2);
    const draft = artifacts.findArtifact(db, 1, id);
    assert.equal(draft.code, '# One, edited');
    assert.equal(draft.state, 'pending');
    assert.deepEqual(
      artifacts.listVersions(db, id).map((v) => v.contentHash),
      ['h1', 'h2'],
    );
  });

  it('keeps the history in the order things happened', () => {
    const db = setup();
    const id = artifacts.insertArtifact(db, DRAFT);
    artifacts.insertEvent(db, {
      workspaceId: 1,
      artifactId: id,
      action: 'artifact_created',
      version: 1,
      actorType: 'xo',
    });
    artifacts.insertEvent(db, {
      workspaceId: 1,
      artifactId: id,
      action: 'approved',
      version: 1,
      actorType: 'user',
      actorName: 'Test User',
    });
    const events = artifacts.listEvents(db, 1, id);
    assert.deepEqual(
      events.map((e) => e.action),
      ['artifact_created', 'approved'],
    );
    assert.equal(events[1].actorName, 'Test User');
    assert.equal(typeof events[0].at, 'number');
  });
});
