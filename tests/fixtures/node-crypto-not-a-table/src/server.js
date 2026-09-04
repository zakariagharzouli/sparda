// `knex('users')` and `createHash('sha256')` are the SAME SHAPE: an identifier
// called with a string literal, then a method from the builder vocabulary. Only
// where the identifier CAME FROM separates a table from a digest algorithm.
import express from 'express';
import { createHash } from 'node:crypto';
import knex from 'knex';

const app = express();
const db = knex({ client: 'pg' });

// A digest, not a table named "sha256".
app.post('/seal', async (req, res) => {
  const digest = createHash('sha256').update(req.body.secret).digest('hex');
  res.json({ digest });
});

// The same crypto chain feeding a REAL write: the write must survive intact.
app.post('/tokens', async (req, res) => {
  const digest = createHash('md5').update(req.body.secret).digest('hex');
  await db('users').update({ digest });
  res.json({ ok: true });
});

// A plain builder write, untouched by any of this.
app.post('/audit', async (req, res) => {
  await db('audit_log').insert({ what: req.body.what });
  res.json({ ok: true });
});

app.listen(3000);
export default app;
