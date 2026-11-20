const knexLib = require('knex');
const path = require('path');
const { openDeep } = require('../../services/secrets');

// Like the app (services/knex.js): saved logins are decrypted when read
process.env.NEXUS_DATA_KEY = process.env.NEXUS_DATA_KEY || Buffer.alloc(32, 7).toString('base64');
const postProcessResponse = (r) => openDeep(r);

// PG_TEST_URL set in CI for the postgres matrix leg; otherwise tests run on sqlite memory.
function makeTestKnex() {
  if (process.env.PG_TEST_URL) {
    // Each test database gets its own schema, so test files never see each other's rows (as each SQLite one is its
    // own in-memory database). The CI database is thrown away after the run.
    const schema = `t_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return knexLib({
      client: 'pg',
      connection: process.env.PG_TEST_URL,
      searchPath: [schema],
      pool: {
        min: 1, max: 2,
        afterCreate: (conn, done) => conn.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"; SET search_path TO "${schema}"`, (err) => done(err, conn)),
      },
      postProcessResponse,
      migrations: { directory: path.join(__dirname, '..', '..', 'db', 'migrations') },
    });
  }
  return knexLib({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' },
    postProcessResponse,
    pool: {
      min: 1, max: 1,
      afterCreate: (c, done) => c.run('PRAGMA foreign_keys = ON;', done),
    },
    migrations: { directory: path.join(__dirname, '..', '..', 'db', 'migrations') },
  });
}

module.exports = { makeTestKnex };
