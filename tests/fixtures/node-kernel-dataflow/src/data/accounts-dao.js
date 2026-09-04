const AccountsDAO = function (db) {
  const accountsCol = db.collection('accounts');

  this.getById = (accountId, callback) => {
    const parsed = parseInt(accountId);
    // the filter document is built by a NESTED helper, as in real DAO code
    const criteria = () => ({ accountId: parsed });
    accountsCol.find(criteria()).toArray(callback);
  };

  this.rename = (accountId, label, callback) => {
    accountsCol.update({ accountId: accountId }, { label: label }, callback);
  };

  this.getScoped = (accountId, userId, callback) => {
    accountsCol.find({ accountId: accountId, requestedBy: userId }).toArray(callback);
  };

  this.getOwned = (userId, callback) => {
    accountsCol.find({ requestedBy: userId }).toArray(callback);
  };
};

module.exports.AccountsDAO = AccountsDAO;
