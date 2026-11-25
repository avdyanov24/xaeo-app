import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../../src/server/config.js';

describe('loadConfig', () => {
  it('applies development defaults', () => {
    const config = loadConfig({});
    assert.equal(config.nodeEnv, 'development');
    assert.equal(config.port, 3000);
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.logLevel, 'info');
    assert.equal(config.isProduction, false);
  });

  it('silences logs in the test environment unless LOG_LEVEL is set', () => {
    assert.equal(loadConfig({ NODE_ENV: 'test' }).logLevel, 'silent');
    assert.equal(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'debug' }).logLevel, 'debug');
  });

  it('returns a frozen object', () => {
    assert.ok(Object.isFrozen(loadConfig({})));
  });

  it('reports every invalid variable at once', () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: 'staging', PORT: '70000', LOG_LEVEL: 'loud' }),
      (error) =>
        /NODE_ENV/.test(error.message) &&
        /PORT/.test(error.message) &&
        /LOG_LEVEL/.test(error.message),
    );
  });

  it('picks a database and session settings for each environment', () => {
    const dev = loadConfig({});
    assert.equal(dev.databasePath, 'data/xaeo.db');
    assert.equal(dev.sessionTtlMs, 14 * 24 * 60 * 60 * 1000);
    assert.equal(dev.secureCookies, false);
    assert.equal(loadConfig({ NODE_ENV: 'test' }).databasePath, ':memory:');
    assert.equal(loadConfig({ NODE_ENV: 'production' }).secureCookies, true);
    assert.equal(
      loadConfig({ DATABASE_PATH: '/var/lib/xaeo.db' }).databasePath,
      '/var/lib/xaeo.db',
    );
  });

  it('rejects an out-of-range SESSION_TTL_DAYS', () => {
    assert.throws(() => loadConfig({ SESSION_TTL_DAYS: '0' }), /SESSION_TTL_DAYS/);
    assert.throws(() => loadConfig({ SESSION_TTL_DAYS: '1.5' }), /SESSION_TTL_DAYS/);
  });
});
