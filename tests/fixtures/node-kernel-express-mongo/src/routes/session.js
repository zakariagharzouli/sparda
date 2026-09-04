function SessionHandler(db) {
  this.isLoggedInMiddleware = (req, res, next) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  };
}

module.exports = SessionHandler;
