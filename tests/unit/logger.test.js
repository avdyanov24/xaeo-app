import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOG_LEVELS, createLogger } from '../../src/server/lib/logger.js';

function capture(options) {
  const lines = [];
  const logger = createLogger({ ...options, write: (line, level) => lines.push({ line, level }) });
  return { logger, lines };
}

describe('logger', () => {
  it('writes one JSON object per call with time, level and message', () => {
    const { logger, lines } = capture();
    logger.info('server started', { port: 3000 });
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0].line);
    assert.equal(entry.level, 'info');
    assert.equal(entry.message, 'server started');
    assert.equal(entry.port, 3000);
    assert.equal(new Date(entry.time).toISOString(), entry.time);
    assert.equal(lines[0].level, 'info');
  });

  it('drops calls below the configured level', () => {
    const { logger, lines } = capture({ level: 'warn' });
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    assert.deepEqual(
      lines.map((l) => JSON.parse(l.line).message),
      ['c', 'd'],
    );
  });

  it('logs everything at debug and nothing when silent', () => {
    const loud = capture({ level: 'debug' });
    for (const name of ['debug', 'info', 'warn', 'error']) loud.logger[name]('x');
    assert.equal(loud.lines.length, 4);

    const quiet = capture({ level: 'silent' });
    for (const name of ['debug', 'info', 'warn', 'error']) quiet.logger[name]('x');
    assert.equal(quiet.lines.length, 0);
  });

  it('falls back to info for an unknown level', () => {
    const { logger, lines } = capture({ level: 'loud' });
    logger.debug('hidden');
    logger.info('shown');
    assert.deepEqual(
      lines.map((l) => JSON.parse(l.line).message),
      ['shown'],
    );
  });

  it('lists the levels it understands', () => {
    assert.deepEqual(LOG_LEVELS, ['debug', 'info', 'warn', 'error', 'silent']);
  });
});
