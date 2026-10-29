const knexLib = require('knex');
const path = require('path');
const { openDeep } = require('../../services/secrets');

// Like the app (services/knex.js): saved logins are decrypted when read
process.env.NEXUS_DATA_KEY = process.env.NEXUS_DATA_KEY || Buffer.alloc(32, 7).toString('base64');
const postProcessResponse = (r) => openDeep(r);

// PG_TEST_URL set in CI for the postgres matrix leg; otherwise tests run on sqlite memory.
function makeTestKnex() {
  if (process.env.PG_TEST_URL) {
    return knexLib({
      client: 'pg',
      connection: process.env.PG_TEST_URL,
      pool: { min: 1, max: 2 },
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
