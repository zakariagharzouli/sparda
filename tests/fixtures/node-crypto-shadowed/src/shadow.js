// `createHash` is imported from node:crypto AND re-declared locally. This module
// cannot tell which declaration a given reference resolves to, so the name must
// be dropped from the proven-non-DB set entirely: UNRESOLVED, never NON_DB_KNOWN.
// Excluding it by text alone is exactly the weakness this fixture exists to pin.
const { createHash } = require('node:crypto');
const hashers = require('./hashers');

function seal(payload) {
  // the local binding SHADOWS the import — and it is a query builder
  const createHash = hashers.forTenant(payload.tenant);
  return createHash('audit_trail').update({ payload });
}

module.exports = { seal, createHash };
