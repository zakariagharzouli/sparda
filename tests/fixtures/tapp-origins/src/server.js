// TAPP-0: which request surface reached the FILTER, and which reached the DATA.
// One helper answers that for every contract; each branch supplies only its own
// argument roles. The two questions are different — a client-chosen filter is an
// object-scope problem, a client-chosen payload is a validation problem.
const express = require('express');
const knex = require('knex');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const db = knex({ client: 'pg' });

// --- Prisma: body reaches the written data, params reaches the filter
app.post('/prisma/users', async (req, res) => {
  await prisma.user.create({ data: { email: req.body.email } });
  res.json({ ok: true });
});

app.post('/prisma/users/:id', async (req, res) => {
  await prisma.user.update({ where: { id: req.params.id }, data: { name: req.body.name } });
  res.json({ ok: true });
});

// --- knex builder: this call carries the document; the filter is a different link
app.post('/knex/accounts', async (req, res) => {
  await db('accounts').insert({ email: req.body.email });
  res.json({ ok: true });
});

// --- active record: values first, options (with `where`) second
app.post('/ar/posts', async (req, res) => {
  await Post.create({ title: req.body.title });
  res.json({ ok: true });
});

app.get('/ar/posts/:id', async (req, res) => {
  res.json(await Post.findAll({ where: { id: req.params.id } }));
});

// --- a value that owes nothing to the request: no origin may be invented
app.post('/static', async (req, res) => {
  await db('audit').insert({ kind: 'boot' });
  res.json({ ok: true });
});

// --- a computed access path is not statically representable: null, never []
app.post('/dynamic', async (req, res) => {
  const key = req.query.field;
  await db('settings').insert(req.body[key]);
  res.json({ ok: true });
});

// --- an OPAQUE PRODUCER at the root of the role: the document is built by a
// function this body cannot open. `originsIn` cannot see inside it, so reporting
// `[]` would claim an inspection that never happened.
app.post('/opaque', async (req, res) => {
  await db('reports').insert(buildReport(req.body));
  res.json({ ok: true });
});

// --- two routes, ONE handler body. The origins belong to the OCCURRENCE, so the
// route that supplies its id from `params` and the route that supplies it from
// `query` must never be credited with each other's surface.
const readOne = async (req, res) => {
  res.json(await Post.findAll({ where: { id: req.params.id } }));
};
app.get('/shared/a/:id', readOne);
app.get('/shared/b/:id', readOne);

app.listen(3000);
module.exports = app;
