// The adversarial half: a name is NOT a proof of origin. Every route here is
// reachable, and the only thing that may ever exclude a builder root is a
// binding this module can prove came from `node:crypto`.
const express = require('express');
const { createHash: sha } = require('node:crypto');
const crypto = require('crypto');
const knex = require('knex');
const shadow = require('./shadow');

const app = express();
const db = knex({ client: 'pg' });

// A RENAMED destructured import is still the crypto binding: `sha('sha256')`
// names an algorithm, not a table.
app.post('/renamed', (req, res) => {
  res.json({ d: sha('sha256').update(req.body.p).digest('hex') });
});

// The default require, used as a namespace. `crypto.createHash(...)` is a
// member call, so the builder rule never saw it as a base call at all — pinned
// so a future change to that rule cannot quietly invent a "sha512" table.
app.post('/namespaced', (req, res) => {
  res.json({ d: crypto.createHash('sha512').update(req.body.p).digest('hex') });
});

// The real write, in the same module as the crypto bindings.
app.post('/tokens', async (req, res) => {
  await db('users').update({ digest: sha('md5').update(req.body.p).digest('hex') });
  res.json({ ok: true });
});

app.post('/shadowed', (req, res) => res.json(shadow.seal(req.body.p)));

// A crypto call whose RECEIVER still mentions the persistence handle. The
// builder rule declines here — the root is proven crypto — and that refusal has
// to stay LOCAL to the builder rule: the conservative opaque-write rule further
// down still has to see this call. Refusing for the WHOLE call instead would
// make a route that touches `db` go silent, which is the one direction this
// analyser may never move in.
app.post('/fingerprint', (req, res) => {
  res.json({ d: sha(db.userParams.algo).update(req.body.p).digest('hex') });
});

app.listen(3000);
module.exports = app;
