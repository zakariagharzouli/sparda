const AccountsHandler = require('./accounts');
const SessionHandler = require('./session');

const index = (app, db) => {
  const accounts = new AccountsHandler(db);
  const session = new SessionHandler(db);
  const isLoggedIn = session.isLoggedInMiddleware;

  // client-chosen id reaches a read filter — no identity constraint
  app.get('/accounts/:accountId', isLoggedIn, accounts.showAccount);
  // request body reaches the modified data of a write
  app.post('/accounts', isLoggedIn, accounts.updateAccount);
  // the safe twin: the filter comes from the session, not from the client
  app.get('/accounts/mine', isLoggedIn, accounts.showMine);
  // the properly scoped pattern: a CLIENT id, CONSTRAINED by the session identity
  app.get('/accounts/:accountId/scoped', isLoggedIn, accounts.showScoped);
};

module.exports = index;
