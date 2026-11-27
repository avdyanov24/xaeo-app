import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';

let db;
let ws;
let other;

beforeEach(() => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Mine');
  other = workspaces.insertWorkspace(db, 'Theirs');
});

describe('workspace settings', () => {
  it('starts with the default brand colour and time zone and no logo', () => {
    assert.deepEqual(workspaces.findWorkspaceSettings(db, ws), {
      id: ws,
      name: 'Mine',
      color: '#1F3BFF',
      website: '',
      contact: '',
      timezone: 'Europe/London',
      hasLogo: false,
      logoUpdatedAt: null,
    });
    assert.equal(workspaces.findWorkspaceSettings(db, 999), undefined);
  });

  it('updates the brand of one workspace only', () => {
    workspaces.updateBrand(db, ws, {
      name: 'Brightline Digital',
      color: '#0F766E',
      website: 'brightline.example',
      contact: 'hello@brightline.example',
    });
    assert.deepEqual(workspaces.findWorkspaceSettings(db, ws), {
      id: ws,
      name: 'Brightline Digital',
      color: '#0F766E',
      website: 'brightline.example',
      contact: 'hello@brightline.example',
      timezone: 'Europe/London',
      hasLogo: false,
      logoUpdatedAt: null,
    });
    assert.equal(workspaces.findWorkspaceSettings(db, other).name, 'Theirs');
  });

  it('stores the time zone', () => {
    workspaces.setTimezone(db, ws, 'Europe/Sofia');
    assert.equal(workspaces.findWorkspaceSettings(db, ws).timezone, 'Europe/Sofia');
    assert.equal(workspaces.findWorkspaceSettings(db, other).timezone, 'Europe/London');
  });

  it('stores, reads back and removes a logo without touching other workspaces', () => {
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]);
    workspaces.setLogo(db, ws, { data, type: 'image/png', updatedAt: '2026-11-27T10:00:00.000Z' });
    const settings = workspaces.findWorkspaceSettings(db, ws);
    assert.equal(settings.hasLogo, true);
    assert.equal(settings.logoUpdatedAt, '2026-11-27T10:00:00.000Z');
    const logo = workspaces.findLogo(db, ws);
    assert.deepEqual([...logo.data], [...data]);
    assert.equal(logo.type, 'image/png');
    assert.equal(workspaces.findLogo(db, other), undefined);

    workspaces.clearLogo(db, ws);
    assert.equal(workspaces.findLogo(db, ws), undefined);
    assert.equal(workspaces.findWorkspaceSettings(db, ws).hasLogo, false);
  });
});
