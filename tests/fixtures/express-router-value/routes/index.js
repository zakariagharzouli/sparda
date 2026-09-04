// The route module: a statically created Router, exported through module.exports,
// composing nested children by literal relative require and literal leaf paths.
const express = require('express');
const router = express.Router();

router.use('/users', require('./users'));
router.use('/admin', require('./admin'));
router.get('/health', (req, res) => res.json({ ok: true }));

module.exports = router;
