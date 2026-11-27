import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import {
  checkLogo,
  createWorkspaceService,
  isSupportedTimezone,
  MAX_LOGO_BYTES,
} from '../../src/server/services/workspace-service.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(8),
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const SVG = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
);

describe('checkLogo', () => {
  it('accepts a PNG, a JPEG and a plain SVG that match their type', () => {
    checkLogo(PNG, 'image/png');
    checkLogo(JPEG, 'image/jpeg');
    checkLogo(SVG, 'image/svg+xml');
  });

  it('refuses a type that is not PNG, JPEG or SVG with 415', () => {
    for (const type of ['image/gif', 'text/html', 'application/octet-stream', ''])
      assert.throws(() => checkLogo(PNG, type), { status: 415 }, type);
  });

  it('refuses bytes that are not the type the upload claims with 422', () => {
    assert.throws(() => checkLogo(JPEG, 'image/png'), { status: 422 });
    assert.throws(() => checkLogo(PNG, 'image/jpeg'), { status: 422 });
    assert.throws(() => checkLogo(Buffer.from('<html></html>'), 'image/svg+xml'), { status: 422 });
    assert.throws(() => checkLogo(Buffer.alloc(0), 'image/png'), { status: 422 });
  });

  it('refuses an SVG that could run script or pull in other content', () => {
    for (const body of [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
      '<svg><foreignObject><div/></foreignObject></svg>',
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>',
    ])
      assert.throws(() => checkLogo(Buffer.from(body), 'image/svg+xml'), { status: 422 }, body);
  });

  it('keeps the size limit at 300 KB', () => {
    assert.equal(MAX_LOGO_BYTES, 300 * 1024);
  });
});

describe('isSupportedTimezone', () => {
  it('accepts UTC and IANA zones, including old aliases the runtime still knows', () => {
    for (const zone of [
      'UTC',
      'Europe/London',
      'Europe/Sofia',
      'America/Argentina/Buenos_Aires',
      'Asia/Calcutta',
    ])
      assert.equal(isSupportedTimezone(zone), true, zone);
  });

  it('refuses offsets, made-up zones and anything that is not a zone name', () => {
    for (const zone of [
      '+01:00',
      'Europe/Nowhere',
      'london',
      '',
      'Europe/London; DROP',
      'utc',
      '../etc',
    ])
      assert.equal(isSupportedTimezone(zone), false, zone);
  });
});

describe('workspace service', () => {
  let db;
  let ws;
  let other;
  let service;
  let clock;

  beforeEach(() => {
    db = openDatabase(':memory:');
    ws = workspaces.insertWorkspace(db, 'Mine');
    other = workspaces.insertWorkspace(db, 'Theirs');
    clock = Date.parse('2026-11-27T10:00:00Z');
    service = createWorkspaceService({ db, now: () => clock });
  });

  it('updates the brand and returns the workspace the web app reads', () => {
    const updated = service.updateBrand(ws, {
      name: 'Brightline Digital',
      color: '#0F766E',
      website: 'brightline.example',
      contact: 'hello@brightline.example',
    });
    assert.deepEqual(updated, {
      id: ws,
      name: 'Brightline Digital',
      color: '#0F766E',
      website: 'brightline.example',
      contact: 'hello@brightline.example',
      timezone: 'Europe/London',
      logo: null,
    });
    assert.equal(service.get(other).name, 'Theirs');
  });

  it('stores a logo, versions its URL by upload time, and removes it', () => {
    const uploaded = service.setLogo(ws, { data: PNG, type: 'image/png' });
    assert.equal(uploaded.logo, `/api/app/brand/logo?v=${clock}`);
    assert.deepEqual([...service.logo(ws).data], [...PNG]);
    assert.throws(() => service.logo(other), { status: 404 });

    clock += 1000;
    assert.equal(
      service.setLogo(ws, { data: JPEG, type: 'image/jpeg' }).logo,
      `/api/app/brand/logo?v=${clock}`,
    );
    assert.equal(service.logo(ws).type, 'image/jpeg');

    assert.equal(service.removeLogo(ws).logo, null);
    assert.throws(() => service.logo(ws), { status: 404 });
  });

  it('keeps the old logo when a new one is refused', () => {
    service.setLogo(ws, { data: PNG, type: 'image/png' });
    assert.throws(() => service.setLogo(ws, { data: PNG, type: 'image/jpeg' }), { status: 422 });
    assert.equal(service.logo(ws).type, 'image/png');
  });

  it('sets a supported time zone and refuses an unknown one with 400', () => {
    assert.deepEqual(service.setTimezone(ws, 'Europe/Sofia'), { timezone: 'Europe/Sofia' });
    assert.equal(service.get(ws).timezone, 'Europe/Sofia');
    assert.throws(() => service.setTimezone(ws, 'Mars/Olympus'), { status: 400 });
    assert.equal(service.get(ws).timezone, 'Europe/Sofia');
    assert.equal(service.get(other).timezone, 'Europe/London');
  });
});
