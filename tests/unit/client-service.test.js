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
