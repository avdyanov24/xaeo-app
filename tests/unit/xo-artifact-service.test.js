import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import { createArtifactService } from '../../src/server/services/xo/artifact-service.js';

const owner = { user: { id: 1, name: 'Owner' }, workspace: { id: 1, role: 'owner' } };
const member = { user: { id: 2, name: 'Member' }, workspace: { id: 1, role: 'member' } };
const outsider = { user: { id: 3, name: 'Other' }, workspace: { id: 2, role: 'owner' } };

function setup() {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO workspaces (id, name) VALUES (1, 'A'), (2, 'B');
    INSERT INTO users (id, email, name, password_hash) VALUES (1, 'o@one.test', 'Owner', 'x'), (2, 'm@one.test', 'Member', 'x'), (3, 'x@two.test', 'Other', 'x');
  `);
  const clientId = clients.insertClient(db, {
    workspaceId: 1,
    name: 'Northside Plumbing',
    domain: 'northsideplumbing.co.uk',
    type: 'Plumber',
    city: 'Leeds',
  });
  const client = clients.findClient(db, 1, clientId);
  const service = createArtifactService({ db });
  const draft = (name = 'jsonld') => service.createDraft(owner, client, name);
  const pending = (id) => service.get(owner, id).card.artifact;
  // Fill the placeholders so the draft can be approved.
  const fillAll = (id) => {
    const { version, placeholders } = pending(id);
    const fill = Object.fromEntries(placeholders.map((name) => [name, 'value']));
    return service.edit(owner, id, { version, fill });
  };
  return { db, service, client, draft, pending, fillAll };
}

describe('xo artifact service', () => {
  it('creates a pending draft with a request for approval and a history', () => {
    const { service, draft } = setup();
    const id = draft();
    const { card, versions, audit } = service.get(owner, id);
    assert.equal(card.state, 'pending');
    assert.equal(card.artifact.version, 1);
    assert.ok(card.artifact.approvalId);
    assert.equal(versions.length, 1);
    assert.deepEqual(
      audit.map((e) => e.action),
      ['artifact_created', 'approval_requested'],
    );
    assert.equal(service.listApprovals(owner).pendingCount, 1);
  });

  it('refuses to approve while placeholders remain', () => {
    const { service, draft, pending } = setup();
    const { approvalId, contentHash } = pending(draft());
    assert.throws(() => service.decide(owner, approvalId, { decision: 'approve', contentHash }), {
      status: 409,
      code: 'approve_blocked',
    });
  });

  it('approves the version the owner reviewed and records who did it', () => {
    const { service, draft, fillAll } = setup();
    const id = draft();
    const { card } = fillAll(id);
    const { approvalId, contentHash } = card.artifact;
    const result = service.decide(owner, approvalId, { decision: 'approve', contentHash });
    assert.equal(result.card.state, 'approved');
    assert.deepEqual(result.card.actions, ['copy', 'download', 'edit']);
    const approved = service.get(owner, id).audit.find((e) => e.action === 'approved');
    assert.equal(approved.actorName, 'Owner');
    assert.equal(service.listApprovals(owner).pendingCount, 0);
  });

  it('lets only an owner decide', () => {
    const { service, draft, fillAll } = setup();
    const { card } = fillAll(draft());
    assert.throws(
      () =>
        service.decide(member, card.artifact.approvalId, {
          decision: 'reject',
          contentHash: card.artifact.contentHash,
        }),
      { status: 403 },
    );
    assert.deepEqual(service.get(member, card.artifact.artifactId).card.actions, ['edit']);
  });

  it('rejects a decision on content that has changed since it was reviewed', () => {
    const { service, draft, fillAll } = setup();
    const { card } = fillAll(draft());
    assert.throws(
      () =>
        service.decide(owner, card.artifact.approvalId, {
          decision: 'approve',
          contentHash: 'not-the-hash',
        }),
      { status: 409, code: 'stale_approval' },
    );
  });

  it('rejecting leaves the draft rejected and decided requests cannot be decided again', () => {
    const { service, draft, pending } = setup();
    const id = draft();
    const { approvalId, contentHash } = pending(id);
    assert.equal(
      service.decide(owner, approvalId, { decision: 'reject', contentHash }).card.state,
      'rejected',
    );
    assert.throws(() => service.decide(owner, approvalId, { decision: 'reject', contentHash }), {
      code: 'stale_approval',
    });
  });

  it('saves an edit as a new version, stales the old request and asks again', () => {
    const { service, draft, pending } = setup();
    const id = draft();
    const first = pending(id);
    const result = service.edit(owner, id, {
      version: 1,
      fill: { FILL_IN_PHONE: '0113 496 0000' },
    });
    assert.equal(result.artifact.version, 2);
    assert.deepEqual(result.staleApprovalIds.length, 1);
    assert.match(result.card.artifact.code, /0113 496 0000/);
    assert.notEqual(result.card.artifact.approvalId, first.approvalId);
    assert.deepEqual(result.card.artifact.placeholders, ['FILL_IN_STREET_ADDRESS']);
    assert.throws(
      () =>
        service.decide(owner, first.approvalId, {
          decision: 'approve',
          contentHash: first.contentHash,
        }),
      { code: 'stale_approval' },
    );
  });

  it('saves nothing for an edit that changes nothing, and refuses an edit of an old version', () => {
    const { service, draft } = setup();
    const id = draft();
    assert.equal(service.edit(owner, id, { version: 1 }).artifact.version, 1);
    service.edit(owner, id, { version: 1, title: 'Renamed' });
    assert.throws(() => service.edit(owner, id, { version: 1, title: 'Again' }), {
      code: 'stale_approval',
    });
    assert.equal(service.get(owner, id).card.artifact.title, 'Renamed');
  });

  it('exports an approved draft once and notes a repeat', () => {
    const { service, draft, fillAll } = setup();
    const id = draft();
    const { card } = fillAll(id);
    const { approvalId, contentHash } = card.artifact;
    assert.throws(() => service.apply(owner, id, { approvalId }), { code: 'stale_approval' });
    service.decide(owner, approvalId, { decision: 'approve', contentHash });
    const first = service.apply(owner, id, { approvalId });
    assert.equal(first.card.state, 'applied');
    assert.equal(first.downloadPath, `/api/app/xo/artifacts/${id}/download`);
    assert.equal(service.apply(owner, id, { approvalId }).card.state, 'applied');
    const actions = service.get(owner, id).audit.map((e) => e.action);
    assert.deepEqual(actions.slice(-2), ['applied', 'apply_duplicate']);
  });

  it('serves the file only after approval, named after the site', () => {
    const { service, draft, fillAll } = setup();
    const id = draft();
    assert.throws(() => service.download(owner, id), { status: 400 });
    const { card } = fillAll(id);
    service.decide(owner, card.artifact.approvalId, {
      decision: 'approve',
      contentHash: card.artifact.contentHash,
    });
    const file = service.download(owner, id);
    assert.equal(file.filename, 'northsideplumbing.co.uk-structured-data.json');
    assert.doesNotThrow(() => JSON.parse(file.body));
    const llms = draft('llms_txt');
    const filled = fillAll(llms);
    service.decide(owner, filled.card.artifact.approvalId, {
      decision: 'approve',
      contentHash: filled.card.artifact.contentHash,
    });
    assert.equal(service.download(owner, llms).filename, 'llms.txt');
  });

  it('keeps drafts inside their workspace', () => {
    const { service, draft } = setup();
    const id = draft();
    assert.throws(() => service.get(outsider, id), { status: 404 });
    assert.throws(() => service.edit(outsider, id, { version: 1, title: 'x' }), { status: 404 });
    assert.deepEqual(service.listApprovals(outsider).approvals, []);
  });

  it('narrows the queue to one client and one status', () => {
    const { service, draft, client } = setup();
    draft();
    draft('llms_txt');
    const all = service.listApprovals(owner, { status: 'all', clientId: client.id });
    assert.equal(all.approvals.length, 2);
    assert.equal(all.client.name, 'Northside Plumbing');
    assert.equal(service.listApprovals(owner, { status: 'approved' }).approvals.length, 0);
    assert.equal(
      service.listApprovals(owner, { status: 'pending' }).approvals[0].clientName,
      'Northside Plumbing',
    );
  });
});
