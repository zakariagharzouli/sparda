const express = require('express');
const { Router } = require('express');
const fakeExpress = require('./fake-express');
const db = require('./db');

const app = express();
const api = app;
api.get('/kept-alias', (_req, res) => res.json({ ok: true }));

const router = Router();
router.post('/kept-router', async (_req, res) => {
  await db.query('INSERT INTO kept_rows (value) VALUES ($1)', ['kept']);
  res.json({ ok: true });
});

// All setup-function bodies are deliberately flattened by the Express lowering.
// These names therefore collide in its statement stream even though JavaScript's
// lexical bindings keep every fake object separate from the real Express app.
function installFactoryShadow() {
  const express = fakeExpress;
  const localApp = express();
  localApp.post('/masked-factory', async () => {
    await db.query('INSERT INTO masked_factory_rows (value) VALUES ($1)', ['fake']);
  });
}

function installAppShadow() {
  const app = fakeExpress();
  app.post('/masked-app', async () => {
    await db.query('INSERT INTO masked_app_rows (value) VALUES ($1)', ['fake']);
  });
}

function installRouterShadow() {
  const { Router } = fakeExpress;
  const router = Router();
  router.post('/masked-router', async () => {
    await db.query('INSERT INTO masked_router_rows (value) VALUES ($1)', ['fake']);
  });
}

let mutableApp = express();
mutableApp = fakeExpress();
mutableApp.post('/ambiguous-reassignment', async () => {
  await db.query('INSERT INTO ambiguous_rows (value) VALUES ($1)', ['unknown']);
});

let chainedApp = express();
chainedApp = fakeExpress();
chainedApp.route('/ambiguous-chain').post(async () => {
  await db.query('INSERT INTO ambiguous_chain_rows (value) VALUES ($1)', ['unknown']);
});

module.exports = app;
