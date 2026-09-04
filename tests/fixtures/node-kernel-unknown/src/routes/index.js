const ReportsHandler = require('./reports');

const index = (app, db) => {
  const reportsHandler = new ReportsHandler(db);

  // `looksLikeAuth` is named like a guard and does nothing — it must NOT be credited.
  const looksLikeAuth = (req, res, next) => next();

  app.post('/reports/:reportId', looksLikeAuth, reportsHandler.updateReport);
};

module.exports = index;
