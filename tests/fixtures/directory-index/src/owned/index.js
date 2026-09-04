const express = require('express');
const router = express.Router();
router.get('/index-not-the-entry', (req, res) => res.json({}));
module.exports = router;
