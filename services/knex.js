const knexLib = require('knex');
const { dbConfig } = require('../config/db');

const knex = knexLib(dbConfig());

module.exports = knex;
