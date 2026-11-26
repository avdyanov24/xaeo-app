// npm run db:seed: fills the configured database with the seed data and test accounts.
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db/database.js';
import { runSeeds } from '../src/server/db/seed/index.js';

const config = loadConfig();
if (config.isProduction) {
  console.error(
    'db:seed refuses to run with NODE_ENV=production: the test accounts have published passwords.',
  );
  process.exit(1);
}

const db = openDatabase(config.databasePath);
try {
  const created = await runSeeds(db);
  for (const [step, items] of Object.entries(created))
    console.log(`${step}: ${items.length ? items.join(', ') : 'already present'}`);
  console.log(`Seeded ${config.databasePath}`);
} finally {
  db.close();
}
