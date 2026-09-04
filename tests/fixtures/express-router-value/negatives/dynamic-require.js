// 1. DYNAMIC require: the specifier is not a literal, so which module is mounted
// is a runtime question. There is no file to open and none may be guessed.
const express = require('express');
const router = express.Router();
const which = process.env.ROUTES || './fallback';
router.get('/kept', (req, res) => res.json({}));
module.exports = router;
