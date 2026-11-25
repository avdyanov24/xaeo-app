import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { createLogger } from './lib/logger.js';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const db = openDatabase(config.databasePath);
const server = createServer(createApp({ config, logger, db }));

server.listen(config.port, config.host, () => {
  const { port } = server.address();
  logger.info('server_started', { url: `http://${config.host}:${port}`, env: config.nodeEnv });
});

function shutdown(signal) {
  logger.info('server_stopping', { signal });
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
