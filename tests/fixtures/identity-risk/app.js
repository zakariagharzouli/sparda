const express = require('express');
const { MongoClient } = require('mongodb');
const Records = require('./records');
const app = express();
const db = new MongoClient('mongodb://localhost').db('app');
const controller = new Records(db);
const gate = (r, s, n) => {
  if (r.session.actor) return n();
  return s.redirect('/login');
};
app.get('/records/:actor', gate, controller.read);
app.listen(3000);
