import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  approveBlocker,
  contentHash,
  fillPlaceholders,
  isWhiteLabel,
  llmsTxt,
  localBusinessJsonLd,
  placeholdersIn,
} from '../../src/server/services/xo/drafts.js';

const CLIENT = {
  name: 'Northside Plumbing',
  domain: 'northsideplumbing.co.uk',
  type: 'Plumber',
  city: 'Leeds',
  country: 'GB',
};

describe('xo drafts', () => {
  it('builds LocalBusiness data from the client record and leaves facts it cannot know', () => {
    const draft = localBusinessJsonLd(CLIENT);
    const data = JSON.parse(draft.code);
    assert.equal(data.name, 'Northside Plumbing');
    assert.equal(data.url, 'https://northsideplumbing.co.uk/');
    assert.equal(data.address.addressLocality, 'Leeds');
    assert.deepEqual(placeholdersIn(draft.code), ['FILL_IN_PHONE', 'FILL_IN_STREET_ADDRESS']);
  });

  it('builds an llms.txt that names the client and the site', () => {
    const draft = llmsTxt(CLIENT);
    assert.match(draft.code, /^# Northside Plumbing/);
    assert.match(draft.code, /Plumber in Leeds/);
    assert.deepEqual(placeholdersIn(draft.code), [
      'FILL_IN_ONE_LINE_SUMMARY',
      'FILL_IN_CONTACT_PATH',
    ]);
  });

  it('fills every occurrence of a placeholder and ignores unknown names', () => {
    const code = 'a FILL_IN_X b FILL_IN_X c FILL_IN_Y';
    assert.equal(
      fillPlaceholders(code, 'text', { FILL_IN_X: ' one ', FILL_IN_Z: 'no' }),
      'a one b one c FILL_IN_Y',
    );
  });

  it('escapes a value so it cannot break the JSON it is filled into', () => {
    const draft = localBusinessJsonLd(CLIENT);
    const filled = fillPlaceholders(draft.code, 'json', {
      FILL_IN_PHONE: '0113 "496" 0000',
      FILL_IN_STREET_ADDRESS: '1 Example Road',
    });
    assert.equal(JSON.parse(filled).telephone, '0113 "496" 0000');
    assert.equal(approveBlocker({ code: filled, lang: 'json' }), null);
  });

  it('blocks approval while placeholders remain, naming how many', () => {
    const draft = localBusinessJsonLd(CLIENT);
    assert.match(approveBlocker(draft), /the 2 placeholders/);
    assert.match(approveBlocker({ code: 'FILL_IN_A', lang: 'text' }), /the 1 placeholder before/);
  });

  it('blocks approval of invalid JSON and of Xaeo branding', () => {
    assert.match(approveBlocker({ code: '{ nope', lang: 'json' }), /not valid JSON/);
    assert.match(approveBlocker({ code: 'Made with Xaeo', lang: 'text' }), /Xaeo and Xo/);
    assert.equal(isWhiteLabel('Examples: exo, taxon'), true);
  });

  it('hashes content the same way every time', () => {
    assert.equal(contentHash('a'), contentHash('a'));
    assert.notEqual(contentHash('a'), contentHash('b'));
    assert.match(contentHash('a'), /^[0-9a-f]{64}$/);
  });
});
