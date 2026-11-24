const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Minimal structured logger: one JSON object per line on stdout (stderr for errors).
 * @param {{ level?: keyof LEVELS, write?: (line: string, level: string) => void }} [options]
 */
export function createLogger({ level = 'info', write } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const sink =
    write ??
    ((line, lvl) => (lvl === 'error' ? process.stderr : process.stdout).write(`${line}\n`));

  const log =
    (lvl) =>
    (message, fields = {}) => {
      if (LEVELS[lvl] < threshold) return;
      sink(JSON.stringify({ time: new Date().toISOString(), level: lvl, message, ...fields }), lvl);
    };

  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

export const LOG_LEVELS = Object.keys(LEVELS);
