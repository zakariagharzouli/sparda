const express = require('express');
const routes = require('./routes/index');
const app = express();
routes(app);
app.listen(3000);
module.exports = app;
