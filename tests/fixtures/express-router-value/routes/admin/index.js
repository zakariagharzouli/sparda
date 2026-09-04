// A THIRD level, reached through a directory index — the nesting has to survive
// more than one hop, and index resolution has to keep working exactly as before.
const express = require('express');
const router = express.Router();

router.use('/reports', require('./reports'));
router.delete('/purge', (req, res) => res.json({}));

module.exports = router;
