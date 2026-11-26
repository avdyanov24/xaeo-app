import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as approvals from '../../src/server/repositories/xo-approval-repository.js';
import * as artifacts from '../../src/server/repositories/xo-artifact-repository.js';

function setup() {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO workspaces (id, name) VALUES (1, 'A'), (2, 'B');
    INSERT INTO users (id, email, name, password_hash) VALUES (1, 'a@one.test', 'A', 'x');
    INSERT INTO clients (id, workspace_id, name, domain) VALUES (1, 1, 'One', 'one.test'), (2, 1, 'Two', 'two.test');
  `);
  const draft = (clientId) =>
    artifacts.insertArtifact(db, {
      workspaceId: 1,
      clientId,
      kind: 'jsonld',
      title: 'LocalBusiness data',
      code: '{}',
      contentHash: 'h1',
    });
  return { db, draft };
}

describe('xo approval repository', () => {
  it('opens a request for one version and finds it by id and by version', () => {
    const { db, draft } = setup();
    const artifactId = draft(1);
    const id = approvals.insertApproval(db, {
      workspaceId: 1,
      artifactId,
      version: 1,
      contentHash: 'h1',
    });
    assert.equal(approvals.findApproval(db, 1, id).status, 'pending');
    assert.equal(approvals.findApprovalForVersion(db, 1, artifactId, 1).id, id);
    assert.equal(approvals.findApproval(db, 2, id), undefined);
  });

  it('records who decided and when', () => {
    const { db, draft } = setup();
    const artifactId = draft(1);
    const id = approvals.insertApproval(db, {
      workspaceId: 1,
      artifactId,
      version: 1,
      contentHash: 'h1',
    });
    approvals.decideApproval(db, 1, id, { status: 'approved', userId: 1 });
    const approval = approvals.findApproval(db, 1, id);
    assert.equal(approval.status, 'approved');
    assert.equal(approval.decidedBy, 1);
    assert.equal(typeof approval.decidedAt, 'number');
  });

  it('filters the queue by status and by client', () => {
    const { db, draft } = setup();
    const one = draft(1);
    const two = draft(2);
    const first = approvals.insertApproval(db, {
      workspaceId: 1,
      artifactId: one,
      version: 1,
      contentHash: 'h1',
    });
    approvals.insertApproval(db, {
      workspaceId: 1,
      artifactId: two,
      version: 1,
      contentHash: 'h1',
    });
    approvals.decideApproval(db, 1, first, { status: 'rejected', userId: 1 });
    assert.equal(approvals.listApprovals(db, 1).length, 2);
    assert.deepEqual(
      approvals.listApprovals(db, 1, { status: 'pending' }).map((a) => a.artifactId),
      [two],
    );
    assert.deepEqual(
      approvals.listApprovals(db, 1, { clientId: 1 }).map((a) => a.id),
      [first],
    );
    assert.deepEqual(approvals.listApprovals(db, 2), []);
  });

  it('marks only open requests stale when a draft is edited', () => {
    const { db, draft } = setup();
    const artifactId = draft(1);
    const open = approvals.insertApproval(db, {
      workspaceId: 1,
      artifactId,
      version: 1,
      contentHash: 'h1',
    });
    const done = approvals.insertApproval(db, {
      workspaceId: 1,
      artifactId,
      version: 1,
      contentHash: 'h1',
    });
    approvals.decideApproval(db, 1, done, { status: 'approved', userId: 1 });
    approvals.markStale(db, 1, artifactId);
    assert.equal(approvals.findApproval(db, 1, open).status, 'stale');
    assert.equal(approvals.findApproval(db, 1, done).status, 'approved');
  });
});
