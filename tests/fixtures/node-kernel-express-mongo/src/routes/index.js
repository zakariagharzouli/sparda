const OrdersHandler = require('./orders');
const SessionHandler = require('./session');

const index = (app, db) => {
  const ordersHandler = new OrdersHandler(db);
  const sessionHandler = new SessionHandler(db);
  const isLoggedIn = sessionHandler.isLoggedInMiddleware;

  app.get('/orders/:orderId', isLoggedIn, ordersHandler.displayOrder);
  app.post('/orders/:orderId/cancel', isLoggedIn, ordersHandler.cancelOrder);
  app.post('/orders/purge', ordersHandler.purgeOrders);
};

module.exports = index;
