const express = require('express');
const app = express();

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).end();
  next();
}

app.post('/safe', requireAuth, (req, res) => {
  db.users.insert(req.body);
  res.status(201).end();
});

// The parser sees this registration, but there is no handler to lower. F2
// must make that absence a high-risk unmeasured surface, never a clean zero.
app.post('/ghost');

module.exports = app;
