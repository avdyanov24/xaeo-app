import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as questions from '../../src/server/repositories/question-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { getAppContext, getOnboarding } from '../../src/server/services/app-service.js';
import { DEFAULT_BRAND_COLOR } from '../../src/server/services/workspace-service.js';

let db;
let workspaceId;

beforeEach(() => {
  db = openDatabase(':memory:');
  workspaceId = workspaces.insertWorkspace(db, 'Brightline Digital');
});

const setBrand = (fields) =>
  workspaces.updateBrand(db, workspaceId, {
    name: 'Brightline Digital',
    color: DEFAULT_BRAND_COLOR,
    website: '',
    contact: '',
    ...fields,
  });

describe('first-run checklist', () => {
  it('starts with every step open', () => {
    assert.deepEqual(getOnboarding(db, workspaceId), {
      client: false,
      questions: false,
      brand: false,
      report: false,
    });
  });

  it('ticks the client step once a client exists and the questions step once one is active', () => {
    const clientId = clients.insertClient(db, { workspaceId, name: 'Acme', domain: 'acme.test' });
    assert.equal(getOnboarding(db, workspaceId).client, true);
    assert.equal(getOnboarding(db, workspaceId).questions, false);

    questions.insertQuestion(db, { workspaceId, clientId, text: 'Who is best?', active: false });
    assert.equal(getOnboarding(db, workspaceId).questions, false);
    questions.insertQuestion(db, { workspaceId, clientId, text: 'Who is cheapest?' });
    assert.equal(getOnboarding(db, workspaceId).questions, true);
  });

  it('ticks the brand step for a logo, a website, a contact line or a changed colour', () => {
    setBrand({ website: 'https://brightline.test' });
    assert.equal(getOnboarding(db, workspaceId).brand, true);
    setBrand({ contact: 'hello@brightline.test' });
    assert.equal(getOnboarding(db, workspaceId).brand, true);
    setBrand({ color: '#00AA55' });
    assert.equal(getOnboarding(db, workspaceId).brand, true);
    setBrand({});
    assert.equal(getOnboarding(db, workspaceId).brand, false);
    workspaces.setLogo(db, workspaceId, {
      data: Buffer.from([1, 2, 3]),
      type: 'image/png',
      updatedAt: '2026-11-28T10:00:00.000Z',
    });
    assert.equal(getOnboarding(db, workspaceId).brand, true);
  });

  it('counts only the workspace that is asked about', () => {
    const other = workspaces.insertWorkspace(db, 'Other Agency');
    clients.insertClient(db, { workspaceId: other, name: 'Theirs', domain: 'theirs.test' });
    assert.equal(getOnboarding(db, workspaceId).client, false);
  });
});

describe('app context', () => {
  const session = () => ({
    user: { id: 7, email: 'user@brightline.test', name: 'Sam', role: 'user' },
    workspace: { id: workspaceId, name: 'Brightline Digital', role: 'owner' },
  });

  it('puts the workspace role on the user and keeps the user fields', () => {
    const context = getAppContext(session(), db);
    assert.deepEqual(context.user, {
      id: 7,
      email: 'user@brightline.test',
      name: 'Sam',
      role: 'user',
      workspaceRole: 'owner',
    });
  });

  it('lists ChatGPT and Claude and marks every engine as sample data', () => {
    const { engines, engineStatus } = getAppContext(session(), db);
    assert.deepEqual(engines, [
      { id: 'chatgpt', name: 'ChatGPT' },
      { id: 'claude', name: 'Claude' },
    ]);
    assert.equal(engineStatus.mode, 'sample');
    assert.deepEqual(
      engineStatus.engines.map((engine) => engine.state),
      ['sample', 'sample'],
    );
  });

  it('describes the workspace brand without the raw logo flags', () => {
    const { workspace, xo } = getAppContext(session(), db);
    assert.equal(workspace.id, workspaceId);
    assert.equal(workspace.color, DEFAULT_BRAND_COLOR);
    assert.equal(workspace.logo, null);
    assert.equal('hasLogo' in workspace, false);
    assert.equal(xo, true);
  });
});
