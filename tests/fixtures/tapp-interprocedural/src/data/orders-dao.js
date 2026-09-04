// A DAO whose method takes its two parameters in the OPPOSITE order to the one
// the caller's names suggest. Provenance must follow the POSITION, never the name.
function OrdersDAO(db) {
  const ordersCol = db.collection('orders');

  this.place = (note, orderId, callback) => {
    ordersCol.update({ _id: orderId }, { $set: { note } }, callback);
  };
}

module.exports = { OrdersDAO };
