const DocsHandler = require('./docs');
const SessionHandler = require('./session');

const index = (app, db) => {
  const docs = new DocsHandler(db);
  const session = new SessionHandler(db);
  const isLoggedIn = session.isLoggedInMiddleware;

  // the session supplies the owner id — a real ownership constraint.
  // Registered FIRST on purpose: it is the body that would otherwise stamp its
  // proof onto the shared effect node for everyone else.
  app.get('/docs/mine', isLoggedIn, docs.listMine);
  // the SAME handler body mounted at a second path: only the route key can tell
  // these two occurrences apart, because they share an owner AND an effect.
  app.get('/docs/shared/:userId', isLoggedIn, docs.listForUser);
  // the client supplies the owner id IN THE FILTER — that is the IDOR
  app.get('/docs/user/:userId', isLoggedIn, docs.listForUser);
};

module.exports = index;
