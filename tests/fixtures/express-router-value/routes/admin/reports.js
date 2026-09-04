const { Router } = require('express');
// the destructured factory form — a Router all the same
const router = Router();

router.get('/', (req, res) => res.json([]));
router.put('/:id', (req, res) => res.json({}));

module.exports = router;
