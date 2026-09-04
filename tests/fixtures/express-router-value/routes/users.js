// the CHAINED factory form — what the pinned external source actually writes,
// and the difference between 11 declared refusals and 11 routes
const router = require('express').Router();

router.get('/', (req, res) => res.json([]));
router.post('/login', (req, res) => res.json({}));
router.get('/:id', (req, res) => res.json({}));

module.exports = router;
