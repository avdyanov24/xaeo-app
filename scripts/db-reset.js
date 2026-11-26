// npm run db:reset: deletes the local database, recreates the schema and seeds it again.
import { rmSync } from 'node:fs';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db/database.js';
import { runSeeds } from '../src/server/db/seed/index.js';

const config = loadConfig();
if (config.isProduction) {
  console.error('db:reset refuses to run with NODE_ENV=production: it deletes the database.');
  process.exit(1);
}
if (config.databasePath === ':memory:') {
  console.error('db:reset needs a database file; DATABASE_PATH is :memory:.');
  process.exit(1);
}

// SQLite in WAL mode keeps two side files next to the database; all three go.
for (const suffix of ['', '-wal', '-shm']) rmSync(config.databasePath + suffix, { force: true });

const db = openDatabase(config.databasePath);
try {
  await runSeeds(db);
  console.log(`Reset and seeded ${config.databasePath}`);
} finally {
  db.close();
}
