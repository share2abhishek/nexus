// Resolves the active edition's database config. DB_CLIENT=sqlite (desktop) or pg (cloud).
const path = require('path');

function dbConfig() {
  const client = process.env.DB_CLIENT || 'sqlite';
  if (client === 'pg') {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when DB_CLIENT=pg');
    return {
      client: 'pg',
      connection: process.env.DATABASE_URL,
      pool: { min: 2, max: 10 },
      migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
    };
  }
  const dataDir = process.env.NEXUS_DATA_DIR || path.join(__dirname, '..', 'data');
  return {
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: { filename: path.join(dataDir, 'nexus.db') },
    pool: {
      // SQLite: enable WAL + FK on every connection
      afterCreate: (conn, done) => {
        conn.run('PRAGMA journal_mode = WAL;', () =>
          conn.run('PRAGMA foreign_keys = ON;', done));
      },
    },
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  };
}

module.exports = { dbConfig };
