const express = require('express');
const app = express();

function persist(req, res) {
  db.users.insert(req.body);
  res.status(201).end();
}

app.post('/users', persist);

module.exports = app;
