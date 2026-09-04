const DocsDAO = require('../data/docs-dao').DocsDAO;

function DocsHandler(db) {
  const docsDAO = new DocsDAO(db);

  this.listForUser = (req, res, next) => {
    const { userId } = req.params;
    docsDAO.byUser(userId, (err, rows) => (err ? next(err) : res.json(rows)));
  };

  this.listMine = (req, res, next) => {
    const { userId } = req.session;
    docsDAO.byUser(userId, (err, rows) => (err ? next(err) : res.json(rows)));
  };
}

module.exports = DocsHandler;
