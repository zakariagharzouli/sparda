// A monorepo app whose mutation logic lives in a workspace package the scan cannot
// open: `@fixture/services` IS declared in the workspace (packages/services has a
// package.json with that name), so it is provably not an external npm dependency —
// and its `main` points at a file that is not there, so nothing behind it is
// readable.
//
// The route must stay OBSERVED — its entrypoint, its handler and the write it does
// itself are all still proven — while the delegated hop becomes an explicit
// `UnknownBoundary(unresolved-workspace-module)` naming the package. Silence here is
// the failure this fixture exists to forbid: a route that delegates its whole write
// path into an unreadable package must never read clean.
const express = require('express');
const services = require('@fixture/services');
const { auditLog } = require('@fixture/services/audit');
const db = require('./db');

const app = express();

app.post('/users/:id', async (req, res) => {
  // the hop that cannot be followed — the package does not open
  await services.updateUser(req.params.id, req.body);
  res.json({ ok: true });
});

// a second route on the SAME package: one root cause, not two opaque stops
app.post('/users/:id/roles', async (req, res) => {
  await services.setRoles(req.params.id, req.body.roles);
  res.json({ ok: true });
});

// a bare call into the same package, imported by subpath
app.post('/audit', async (req, res) => {
  await auditLog(req.body.what);
  res.json({ ok: true });
});

// a route whose write is fully local — it must keep its proven parts
app.post('/notes', async (req, res) => {
  await db('notes').insert({ body: req.body.body });
  res.json({ ok: true });
});

// ---- the adversarial pair: same application, one route depends on the
// unreadable package and one does not. They exist to pin that the incompleteness
// is LOCAL — degrading both would be indistinguishable from no analysis.
app.post('/affected', async (req, res) => {
  await services.chargeAccount(req.params.id, req.body.amount);
  res.json({ ok: true });
});

app.post('/independent', async (req, res) => {
  await db('ledger').insert({ amount: req.body.amount });
  res.json({ ok: true });
});

app.listen(3000);
module.exports = app;
