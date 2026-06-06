const knexLib = require('knex');
const path = require('path');

// PG_TEST_URL set in CI for the postgres matrix leg; otherwise tests run on sqlite memory.
function makeTestKnex() {
  if (process.env.PG_TEST_URL) {
    return knexLib({ client: 'pg', connection: process.env.PG_TEST_URL, pool: { min: 1, max: 2 } });
  }
  return knexLib({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' },
    pool: {
      min: 1, max: 1,
      afterCreate: (c, done) => c.run('PRAGMA foreign_keys = ON;', done),
    },
    migrations: { directory: path.join(__dirname, '..', '..', 'db', 'migrations') },
  });
}

module.exports = { makeTestKnex };
