// TAPP-2 V1 — one real multi-file trajectory, and every refusal beside it.
//
//   route → req.body → handler factory → captured DAO instance → positional
//   argument → DAO parameter → Mongo filter/data
//
// The hop is accepted ONLY when the receiver, the instance, the method body and
// the parameter positions are all statically resolved. Anything less is a named
// boundary; a route may never look cleaner because a hop was guessed.
const express = require('express');
const { MongoClient } = require('mongodb');
const BenefitsHandler = require('./routes/benefits');

const app = express();
const db = new MongoClient('mongodb://localhost').db('app');
const handler = new BenefitsHandler(db);

app.post('/benefits', handler.updateBenefits);
app.post('/orders/:id', handler.placeOrder);
app.get('/owner/:owner', handler.byPathOwner);
app.get('/owner', handler.byQueryOwner);
app.post('/rewrite', handler.rewrite);
app.post('/spread', handler.spread);
app.get('/rest', handler.rest);
app.get('/duplicate', handler.duplicate);
app.get('/combined', handler.combined);
app.post('/missing', handler.missing);
app.post('/computed', handler.computed);
app.post('/unresolved', handler.unresolved);

app.listen(3000);
module.exports = app;
