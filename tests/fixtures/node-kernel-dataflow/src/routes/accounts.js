const AccountsDAO = require('../data/accounts-dao').AccountsDAO;

function AccountsHandler(db) {
  const accountsDAO = new AccountsDAO(db);

  this.showAccount = (req, res, next) => {
    const { accountId } = req.params;
    accountsDAO.getById(accountId, (err, account) =>
      err ? next(err) : res.json(account),
    );
  };

  this.updateAccount = (req, res, next) => {
    const { accountId, label } = req.body;
    accountsDAO.rename(accountId, label, (err) => (err ? next(err) : res.json({})));
  };

  this.showScoped = (req, res, next) => {
    const { accountId } = req.params;
    const { userId } = req.session;
    accountsDAO.getScoped(accountId, userId, (err, row) =>
      err ? next(err) : res.json(row),
    );
  };

  this.showMine = (req, res, next) => {
    const { userId } = req.session;
    accountsDAO.getOwned(userId, (err, rows) => (err ? next(err) : res.json(rows)));
  };
}

module.exports = AccountsHandler;
