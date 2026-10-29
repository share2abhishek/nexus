const knexLib = require('knex');
const { dbConfig } = require('../config/db');
const { openDeep } = require('./secrets');

// Saved logins and personal API keys are stored encrypted (services/secrets.js);
// every query result is decrypted here, so the rest of the app reads plain values.
const knex = knexLib({ ...dbConfig(), postProcessResponse: (result) => openDeep(result) });

module.exports = knex;
