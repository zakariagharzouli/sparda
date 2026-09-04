const knex = require('knex');

const db = knex({ client: 'pg' });

module.exports.forTenant = (tenant) => db.withSchema(tenant);
