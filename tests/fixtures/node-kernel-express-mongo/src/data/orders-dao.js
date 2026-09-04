const OrdersDAO = function (db) {
  const ordersCol = db.collection('orders');
  const auditCol = db.collection('audit');

  this.getById = (orderId, callback) => {
    ordersCol.findOne({ status: 'open' }, callback);
  };

  this.cancel = (orderId, payload) => {
    return ordersCol.update({ status: 'open' }, payload);
  };

  this.purge = () => {
    auditCol.insert({ kind: 'purge' });
    return ordersCol.deleteMany({});
  };
};

module.exports.OrdersDAO = OrdersDAO;
