import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { artifactActions, artifactCard, scanCard } from '../../src/server/services/xo/cards.js';

const CLIENT = { id: 7, name: 'Northside Plumbing', questions: 5, runningId: null };
const ARTIFACT = {
  id: 3,
  clientId: 7,
  kind: 'llms_txt',
  title: 'llms.txt for Northside Plumbing',
  summary: 'A guide.',
  targetUrl: 'https://northsideplumbing.co.uk/llms.txt',
  lang: 'markdown',
  risk: 'low',
  code: '# Northside Plumbing',
  version: 1,
  state: 'pending',
  notes: [],
  claims: ['Contact page path'],
};

describe('xo cards: artifact actions', () => {
  it('lets an owner approve, reject and edit a pending draft', () => {
    assert.deepEqual(artifactActions({ state: 'pending', blocked: null, canDecide: true }), [
      'approve',
      'reject',
      'edit',
    ]);
  });

  it('hides Approve while something blocks it, and hides both for a member', () => {
    assert.deepEqual(artifactActions({ state: 'pending', blocked: 'Fill in', canDecide: true }), [
      'reject',
      'edit',
    ]);
    assert.deepEqual(artifactActions({ state: 'pending', blocked: null, canDecide: false }), [
      'edit',
    ]);
  });

  it('offers copy and download once a draft is approved or exported', () => {
    for (const state of ['approved', 'applied'])
      assert.deepEqual(artifactActions({ state, blocked: null, canDecide: true }), [
        'copy',
        'download',
        'edit',
      ]);
    assert.deepEqual(artifactActions({ state: 'rejected', blocked: null, canDecide: true }), [
      'edit',
    ]);
  });
});

describe('xo cards: artifact card', () => {
  const build = (artifact = ARTIFACT, canDecide = true) =>
    artifactCard({ artifact, approval: { id: 9, contentHash: 'abc' }, client: CLIENT, canDecide });

  it('carries what the card needs and the id of the approval to decide', () => {
    const card = build();
    assert.equal(card.cardId, 'art-3');
    assert.equal(card.clientName, 'Northside Plumbing');
    assert.equal(card.artifact.approvalId, 9);
    assert.equal(card.artifact.contentHash, 'abc');
    assert.equal(card.artifact.downloadPath, null);
  });

  it('lists placeholders, shows the claims only while they remain, and blocks Approve', () => {
    const open = build({ ...ARTIFACT, code: '# Name\nFILL_IN_PHONE' });
    assert.deepEqual(open.artifact.placeholders, ['FILL_IN_PHONE']);
    assert.deepEqual(open.artifact.unsupportedClaims, ['Contact page path']);
    assert.match(open.artifact.approveBlockedBy, /placeholder/);
    assert.equal(open.actions.includes('approve'), false);
    const done = build();
    assert.deepEqual(done.artifact.unsupportedClaims, []);
    assert.equal(done.artifact.approveBlockedBy, null);
  });

  it('gives an approved draft a download path', () => {
    assert.equal(
      build({ ...ARTIFACT, state: 'approved' }).artifact.downloadPath,
      '/api/app/xo/artifacts/3/download',
    );
  });
});

describe('xo cards: scan card', () => {
  const engines = [{ name: 'ChatGPT' }, { name: 'Claude' }];

  it('offers Run scan and Not now while open', () => {
    const card = scanCard(CLIENT, { engines, state: 'open', cardId: 'card-1' });
    assert.deepEqual(card.actions, ['run_scan', 'dismiss']);
    assert.deepEqual(card.scan.engines, engines);
    assert.equal(card.scan.questions, 5);
  });

  it('offers nothing once done or dismissed, and says when a scan is running', () => {
    assert.deepEqual(
      scanCard(CLIENT, { engines, state: 'dismissed', cardId: 'card-1' }).actions,
      [],
    );
    assert.equal(
      scanCard({ ...CLIENT, runningId: 2 }, { engines, state: 'open', cardId: 'card-1' }).scan
        .running,
      true,
    );
  });
});
