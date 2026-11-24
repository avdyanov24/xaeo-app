import { LOG_LEVELS } from './lib/logger.js';

const NODE_ENVS = ['development', 'test', 'production'];

/**
 * Reads and validates configuration from environment variables.
 * Fails fast with one message listing every problem, so a bad deploy never half-starts.
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const problems = [];
  const nodeEnv = env.NODE_ENV || 'development';
  if (!NODE_ENVS.includes(nodeEnv))
    problems.push(`NODE_ENV must be one of ${NODE_ENVS.join(', ')}`);

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    problems.push('PORT must be an integer between 0 and 65535');

  const logLevel = env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info');
  if (!LOG_LEVELS.includes(logLevel))
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);

  if (problems.length) throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);

  return Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === 'production',
    host: env.HOST || '127.0.0.1',
    port,
    logLevel,
  });
}
