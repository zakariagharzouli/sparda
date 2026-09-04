// Blind fixture: the module selected at runtime is deliberately outside the
// declared semantic-linker subset. The static compiler must not guess which
// file receives `app`, so ZERO entrypoints reach the graph. This is the shape
// that used to compile to a vacuous "PROVEN over 0 nodes"; the provability
// guard now makes it an honest NO PROOF instead.
const express = require('express');
const app = express();

const loaderSpecifier = process.env.SPARDA_TEST_LOADER;
require(loaderSpecifier)(app);

module.exports = app;
