// A FUNCTION export is real middleware and MUST keep its existing treatment
// exactly — reading it as a mount would move guard credit.
module.exports = function requireAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'no' });
  return next();
};
