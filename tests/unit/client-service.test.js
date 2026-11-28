import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { createClientService, normalizeDomain } from '../../src/server/services/client-service.js';

const T0 = Date.parse('2026-11-28T09:00:00Z');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let db;
let ws;
let service;

beforeEach(() => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Brightline Digital');
  service = createClientService({ db, now: () => T0 });
});

const details = (overrides = {}) => ({
  name: 'Northside Plumbing',
  domain: 'northsideplumbing.co.uk',
  type: 'Plumber',
  city: 'Leeds',
  country: 'GB',
  questions: [{ text: 'Who is the best plumber in Leeds?', intent: 'find' }],
  ...overrides,
});

describe('normalizeDomain', () => {
  it('keeps a bare host name', () => {
    assert.equal(normalizeDomain('northsideplumbing.co.uk'), 'northsideplumbing.co.uk');
  });

  it('drops the scheme, the www prefix, the path, the query and the fragment', () => {
    assert.equal(
      normalizeDomain('  https://www.Northsideplumbing.co.uk/contact?x=1#top '),
      'northsideplumbing.co.uk',
    );
  });

  it('returns an empty string for input that is not a host name', () => {
    for (const input of ['', 'localhost', 'not a domain', 'https://', 'a_b.example.com'])
      assert.equal(normalizeDomain(input), '', input);
  });
});

describe('create', () => {
  it('stores the client with its starting questions and the weekly rescan due in a week', () => {
    const { id } = service.create(ws, details({ domain: 'https://www.NorthsidePlumbing.co.uk/' }));
    const client = service.get(ws, id);
    assert.equal(client.domain, 'northsideplumbing.co.uk');
    assert.equal(client.weekly, true);
    assert.equal(client.nextRunAt, new Date(T0 + WEEK_MS).toISOString());
    assert.deepEqual(
      client.questions.map((q) => q.text),
      ['Who is the best plumber in Leeds?'],
    );
  });

  it('rejects a domain that is not a host name and stores nothing', () => {
    assert.throws(() => service.create(ws, details({ domain: 'not a domain' })), {
      status: 422,
    });
    assert.deepEqual(service.list(ws), { clients: [], archivedCount: 0 });
  });
});

describe('update', () => {
  it('switches the weekly rescan off and back on, due a week from the change', () => {
    const { id } = service.create(ws, details());
    assert.equal(service.update(ws, id, { weekly: false }).nextRunAt, null);
    const back = service.update(ws, id, { weekly: true });
    assert.equal(back.weekly, true);
    assert.equal(back.nextRunAt, new Date(T0 + WEEK_MS).toISOString());
  });

  it('normalises a new domain and refuses one that is not a host name', () => {
    const { id } = service.create(ws, details());
    assert.equal(
      service.update(ws, id, { domain: 'https://www.Northside.example/' }).domain,
      'northside.example',
    );
    assert.throws(() => service.update(ws, id, { domain: 'nope' }), { status: 422 });
    assert.equal(service.get(ws, id).domain, 'northside.example');
  });

  it('does not schedule a rescan for an archived client', () => {
    const { id } = service.create(ws, details());
    service.archive(ws, id);
    assert.equal(service.update(ws, id, { weekly: true }).nextRunAt, null);
  });
});

describe('archive and unarchive', () => {
  it('hides the client from the active list, counts it as archived and stops the rescan', () => {
    const { id } = service.create(ws, details());
    service.archive(ws, id);
    assert.deepEqual(service.list(ws), { clients: [], archivedCount: 1 });
    const [archived] = service.list(ws, { archived: true }).clients;
    assert.equal(archived.status, 'archived');
    assert.equal(archived.weekly, false);
  });

  it('brings the client back to the active list', () => {
    const { id } = service.create(ws, details());
    service.archive(ws, id);
    service.unarchive(ws, id);
    const { clients, archivedCount } = service.list(ws);
    assert.equal(clients.length, 1);
    assert.equal(clients[0].status, 'active');
    assert.equal(archivedCount, 0);
  });
});

describe('workspace scope', () => {
  it('answers 404 for a client that belongs to another workspace', () => {
    const { id } = service.create(ws, details());
    const other = workspaces.insertWorkspace(db, 'Another Agency');
    assert.throws(() => service.get(other, id), { status: 404 });
    assert.throws(() => service.update(other, id, { weekly: false }), { status: 404 });
    assert.throws(() => service.archive(other, id), { status: 404 });
    assert.throws(() => service.addQuestion(other, id, { text: 'Who is best?', intent: 'find' }), {
      status: 404,
    });
    assert.deepEqual(service.list(other), { clients: [], archivedCount: 0 });
  });
});
