const express = require('express');
const routes = require('./routes/index');
const app = express();
const db = { collection: (n) => n };
routes(app, db);
app.listen(3000);
module.exports = app;
