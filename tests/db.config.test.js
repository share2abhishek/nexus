const { dbConfig } = require('../config/db');

describe('dbConfig', () => {
  afterEach(() => { delete process.env.DB_CLIENT; delete process.env.DATABASE_URL; });

  test('defaults to sqlite3', () => {
    expect(dbConfig().client).toBe('sqlite3');
  });

  test('uses pg when DB_CLIENT=pg', () => {
    process.env.DB_CLIENT = 'pg';
    process.env.DATABASE_URL = 'postgres://u:p@localhost/db';
    const c = dbConfig();
    expect(c.client).toBe('pg');
    expect(c.connection).toBe('postgres://u:p@localhost/db');
  });

  test('throws when DB_CLIENT=pg and DATABASE_URL missing', () => {
    process.env.DB_CLIENT = 'pg';
    delete process.env.DATABASE_URL;
    expect(() => dbConfig()).toThrow('DATABASE_URL is required');
  });
});
