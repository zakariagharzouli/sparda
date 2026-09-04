// Middleware bound to an IDENTIFIER first, then exported. Same meaning as
// `module.exports = function (...)`, different AST shape — and the shape is what
// the check has to cover.
const attachRequestId = (req, res, next) => {
  req.id = String(Date.now());
  return next();
};

module.exports = attachRequestId;
