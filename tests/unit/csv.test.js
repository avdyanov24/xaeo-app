import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { csvField, toCsv } from '../../src/server/services/fixes/csv.js';

describe('csvField', () => {
  it('leaves plain text alone', () => {
    assert.equal(csvField('Northside Plumbing'), 'Northside Plumbing');
    assert.equal(csvField(42), '42');
  });

  it('writes nothing for null and undefined', () => {
    assert.equal(csvField(null), '');
    assert.equal(csvField(undefined), '');
  });

  it('quotes fields with commas, quotes and line breaks, and doubles the quotes', () => {
    assert.equal(csvField('a,b'), '"a,b"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField('one\ntwo'), '"one\ntwo"');
    assert.equal(csvField('one\r\ntwo'), '"one\r\ntwo"');
  });

  it('defuses cells a spreadsheet would run as a formula', () => {
    for (const bad of ['=SUM(A1:A9)', '+1', '-1', '@cmd', '\tindented', '\rreturn'])
      assert.ok(csvField(bad).replace(/^"/, '').startsWith("'"), JSON.stringify(bad));
    assert.equal(csvField('=1+1'), "'=1+1");
  });

  it('defuses a formula that also needs quoting, keeping one valid field', () => {
    assert.equal(
      csvField('=HYPERLINK("http://x.test","a")'),
      `"'=HYPERLINK(""http://x.test"",""a"")"`,
    );
  });

  it('does not touch an equals sign or a dash inside the text', () => {
    assert.equal(csvField('a=b - c'), 'a=b - c');
  });
});

describe('toCsv', () => {
  it('joins fields with commas and records with CRLF, ending with one', () => {
    assert.equal(
      toCsv([
        ['Fix ID', 'Title'],
        ['1', 'Add data, fast'],
      ]),
      'Fix ID,Title\r\n1,"Add data, fast"\r\n',
    );
  });

  it('writes only the header for no rows', () => {
    assert.equal(toCsv([['A', 'B']]), 'A,B\r\n');
  });
});
