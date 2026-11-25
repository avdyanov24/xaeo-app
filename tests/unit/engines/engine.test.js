import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertEngine,
  ENGINE_IDS,
  EngineError,
  isEngineId,
} from '../../../src/server/services/engines/engine.js';

describe('engine interface', () => {
  it('knows exactly ChatGPT and Claude', () => {
    assert.deepEqual(ENGINE_IDS, ['chatgpt', 'claude']);
    assert.equal(isEngineId('chatgpt'), true);
    assert.equal(isEngineId('claude'), true);
    assert.equal(isEngineId('gemini'), false);
    assert.equal(isEngineId('toString'), false);
  });

  it('accepts an object with a known id and an ask function', () => {
    const engine = { id: 'claude', name: 'Claude', ask: async () => ({ text: '', citations: [] }) };
    assert.equal(assertEngine(engine), engine);
  });

  it('rejects values that are not engines', () => {
    assert.throws(() => assertEngine(null), /must be an object/);
    assert.throws(() => assertEngine({ id: 'other', ask() {} }), /Unknown engine id: other/);
    assert.throws(() => assertEngine({ id: 'claude' }), /ask\(question\)/);
  });

  it('carries a stable code on EngineError', () => {
    const error = new EngineError('no_answer', 'Nothing to say.');
    assert.equal(error.code, 'no_answer');
    assert.equal(error.name, 'EngineError');
    assert.ok(error instanceof Error);
  });
});
