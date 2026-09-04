const express = require('express');
const router = express.Router();
router.post('/real-module-route', (req, res) => res.json({}));
module.exports = router;
