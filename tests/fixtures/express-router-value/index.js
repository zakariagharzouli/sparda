// Express CommonJS router-value V1 — the exact shape, and every refusal beside it.
//
//   const routes = require('./routes');
//   app.use(routes);
//
// The router value is mounted WITHOUT a path. That is the same mount as
// `app.use('/', routes)`, and until this slice it read as one middleware named
// `routes` while the whole route tree disappeared with no trace.
const express = require('express');
const app = express();

// POSITIVE: a statically created Router, nested three levels deep.
const routes = require('./routes');
app.use(routes);

// 1. dynamic require — the specifier is a runtime value
const dynamicName = process.env.ROUTES_MODULE || './negatives/dynamic-require';
app.use(require(dynamicName));

// 2. object export — not a Router, no route table to read
const objectRoutes = require('./negatives/object-export');
app.use(objectRoutes);

// 3. bare external package — not a project module at all
const helmet = require('helmet');
app.use(helmet);

// 5. a require cycle between two route modules
const cyclic = require('./negatives/cycle-a');
app.use(cyclic);

// 4. dynamic mount PREFIX: the router is provable and its location is not.
// Mounting it would publish the whole sub-tree at a path nobody proved.
const mountAt = process.env.API_PREFIX || '/api';
app.use(mountAt, routes);

// A local `Router` factory that is NOT express's — the provenance, not the name,
// is what decides.
const lookalikeRouter = require('./negatives/lookalike-router');
app.use(lookalikeRouter);

// Middleware bound to an identifier before export — middleware all the same.
const attachRequestId = require('./negatives/identifier-middleware');
app.use(attachRequestId);

// A FUNCTION export stays middleware, byte for byte. This is the control that
// proves the discriminator is "exports a Router", not "was required relatively".
const requireAuth = require('./negatives/function-export');
app.use(requireAuth);

app.listen(3000);
module.exports = app;
