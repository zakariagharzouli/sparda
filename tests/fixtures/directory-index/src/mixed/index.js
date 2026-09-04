const express = require('express');
const router = express.Router();
router.get('/from-directory-index', (req, res) => res.json({}));
module.exports = router;
