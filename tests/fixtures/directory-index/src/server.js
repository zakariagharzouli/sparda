// Every shape of `require('./dir')` a CommonJS Express app can mount, and which
// of them SPARDA is allowed to resolve. Resolving one it should not means
// analysing a file the server never loads: the routes reported are not the
// routes served, in BOTH directions.
const express = require('express');
const app = express();
const target = process.env.ROUTES_MODULE;

// 1 — resolvable: the directory has exactly one index.js and no manifest
app.use('/api', require('./routes'));

// 2 — a FILE always beats a directory index, exactly as Node orders them
app.use('/mixed', require('./mixed'));

// 3 — a dynamic specifier is not a static target
app.use('/dynamic', require(target));

// 4 — a real directory with no index at all
app.use('/no-index', require('./no-index'));

// 5 — the directory carries its own package.json: Node consults `main`, so
// guessing index.js analyses a DIFFERENT module than the one that runs
app.use('/owned', require('./owned'));

// 6 — a bare package is not a local directory
app.use('/bare', require('express'));

// 7 — index.cjs is not index.js; Node's CJS directory lookup does not try it
app.use('/cjs', require('./cjs-only'));
app.use('/esm', require('./esm-only'));

// 10 — outside the analysed source tree
app.use('/outside', require('../outside'));

// a plain local route, present throughout, so a lost mount is never mistaken
// for an empty application
app.post('/local', (req, res) => res.json({}));

app.listen(3000);
module.exports = app;
