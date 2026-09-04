const OrdersDAO = require('../data/orders-dao').OrdersDAO;

function OrdersHandler(db) {
  const ordersDAO = new OrdersDAO(db);

  // positional Node callback: the DB effect lives behind a continuation
  this.displayOrder = (req, res, next) => {
    const { orderId } = req.params;
    ordersDAO.getById(orderId, (err, order) => {
      if (err) return next(err);
      return res.json(order);
    });
  };

  // await / promise continuation into the same DAO
  this.cancelOrder = async (req, res) => {
    const { orderId } = req.params;
    await ordersDAO.cancel(orderId, req.body);
    return res.json({ ok: true });
  };

  // no guard on the chain at all — an unguarded mutation
  this.purgeOrders = (req, res) => {
    ordersDAO.purge().then(() => res.json({ ok: true }));
  };
}

module.exports = OrdersHandler;
