import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareToPrevious,
  describeConfiguration,
} from '../../src/server/services/scan-comparison.js';

const rows = (...questionIds) => questionIds.map((questionId) => ({ questionId }));

describe('describeConfiguration', () => {
  it('lists each question once, as text, and says the answers are scripted samples', () => {
    const config = describeConfiguration(rows(1, 1, 2));
    assert.equal(config.state, 'recorded');
    assert.equal(config.source, 'sample');
    assert.deepEqual(config.snapshot.questions, ['1', '2']);
    assert.match(config.limitations[0], /scripted sample data/);
  });
});

describe('compareToPrevious', () => {
  it('starts a baseline when there is no earlier scan', () => {
    const result = compareToPrevious(rows(1, 2), undefined);
    assert.equal(result.comparable, false);
    assert.match(result.reasons[0].message, /first scan/);
  });

  it('is comparable when both scans asked the same questions, in any order', () => {
    assert.deepEqual(compareToPrevious(rows(1, 2, 2), rows(2, 1)), {
      comparable: true,
      reasons: [],
    });
  });

  it('starts a new baseline when the questions changed', () => {
    const result = compareToPrevious(rows(1, 2), rows(1, 3));
    assert.equal(result.comparable, false);
    assert.match(result.reasons[0].message, /questions changed/);
    assert.equal(compareToPrevious(rows(1), rows(1, 2)).comparable, false);
  });
});
