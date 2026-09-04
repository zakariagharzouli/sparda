// 5. CYCLE: two route modules requiring each other. The module graph does not
// settle statically, so the walk declares the limit instead of unrolling it.
const express = require('express');
const router = express.Router();
router.use('/b', require('./cycle-b'));
module.exports = router;
