// TAPP-1: THROUGH WHAT a request value reached a DB role, on which route.
//
// TAPP-0 can already say "something from the body reached this payload". That is
// not a statement a reader can act on. `req.body.email → email → data.email` is.
//
// Every route below is either a form the closed V1 grammar states exactly, or a
// form it must refuse OUT LOUD. There is no third outcome: an origin that reached
// a role and cannot be placed is declared, never dropped, because an absence and
// an unreadable path read identically downstream.
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
const client = new MongoClient('mongodb://localhost');
const db = client.db('app');

// --- 1. body → local assignment → object literal → data
app.post('/local', async (req, res) => {
  const users = db.collection('users');
  const email = req.body.email;
  await users.insertOne({ email });
  res.json({ ok: true });
});

// --- 2. params → local normalizer → filter. `parseInt` does not launder
// provenance, and the transform must stay VISIBLE in the path: a value that
// crossed a converter is not a value that arrived untouched.
app.get('/normalized/:id', async (req, res) => {
  const items = db.collection('items');
  const id = req.params.id;
  const parsedId = parseInt(id);
  res.json(await items.findOne({ id: parsedId }));
});

// --- 3. static destructuring — the dominant Node handler idiom
app.post('/destructured', async (req, res) => {
  const users = db.collection('users');
  const { email } = req.body;
  await users.insertOne({ email });
  res.json({ ok: true });
});

// --- 3b. an alias chain, and a NESTED static key
app.post('/nested', async (req, res) => {
  const users = db.collection('users');
  const raw = req.body.email;
  const alias = raw;
  await users.insertOne({ profile: { email: alias } });
  res.json({ ok: true });
});

// --- 3c. ONE source landing at TWO destinations. Both are real; a fact key that
// stopped at the source would keep whichever the walk reached first and delete
// the other, which is a path the app takes and the evidence denies.
app.post('/twice', async (req, res) => {
  const users = db.collection('users');
  const email = req.body.email;
  await users.insertOne({ primary: email, backup: email });
  res.json({ ok: true });
});

// --- 4. two routes, ONE handler body. The path belongs to the OCCURRENCE, so
// neither route may be credited with the other's proof.
const lookup = async (req, res) => {
  res.json(await Item.findAll({ where: { id: req.params.id } }));
};
app.get('/shared/a/:id', lookup);
app.get('/shared/b/:id', lookup);

// --- 5. a computed member: `req.body[key]` is not a static access path
app.post('/computed', async (req, res) => {
  const users = db.collection('users');
  const key = req.query.field;
  await users.insertOne({ email: req.body[key] });
  res.json({ ok: true });
});

// --- 5b. a computed KEY on the destination side is the same refusal
app.post('/computed-key', async (req, res) => {
  const users = db.collection('users');
  const slot = req.query.slot;
  await users.insertOne({ [slot]: req.body.email });
  res.json({ ok: true });
});

// --- 5c. a whole-surface pass. The flow is real and the PROPERTY SET is not
// readable — the shape mass assignment lives in, so precision here would be the
// most expensive kind of invention.
app.post('/whole', async (req, res) => {
  const users = db.collection('users');
  await users.insertOne(req.body);
  res.json({ ok: true });
});

// --- 5d. a spread, and an array: neither is a static destination
app.post('/spread', async (req, res) => {
  const users = db.collection('users');
  await users.insertOne({ ...req.body, seen: true });
  res.json({ ok: true });
});

app.post('/array', async (req, res) => {
  const users = db.collection('users');
  await users.insertMany([{ email: req.body.email }]);
  res.json({ ok: true });
});

// --- 6. a value that owes nothing to the request: no link may be invented
app.post('/independent', async (req, res) => {
  const users = db.collection('users');
  const email = 'boot@example.com';
  await users.insertOne({ email });
  res.json({ ok: true });
});

// --- 7. a real DB effect whose source surface is outside the V1 grammar. The
// EFFECT must survive intact; only its path is unknown.
app.post('/session-source', async (req, res) => {
  const items = db.collection('items');
  await items.updateOne({ owner: req.session.userId }, { seen: true });
  res.json({ ok: true });
});

app.listen(3000);
module.exports = app;
