const express = require('express');
const router = express.Router();
router.use('/a', require('./cycle-a'));
module.exports = router;
