// `Router()` — but from './fake-express', not from 'express'. A name is not a
// provenance: mounting this would publish a route tree that no Express router
// serves.
const fakeExpress = require('./fake-express');
const router = fakeExpress.Router();

router.get('/lookalike', (req, res) => res.json({}));

module.exports = router;
