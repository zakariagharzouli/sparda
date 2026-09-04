const ReportsDAO = require('../data/reports-dao').ReportsDAO;

function ReportsHandler(db) {
  const reportsDAO = new ReportsDAO(db);

  this.updateReport = (req, res, next) => {
    // `archive` is not declared on ReportsDAO: a real behavioural hop that ends here.
    reportsDAO.archive(req.params.reportId, (err) => {
      if (err) return next(err);
      return res.json({ ok: true });
    });
  };
}

module.exports = ReportsHandler;
