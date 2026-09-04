const ItemsDAO = function (db, tableName) {
  // The collection name is NOT a literal: it must stay symbolic, never guessed.
  const itemsCol = db.collection(tableName);

  this.create = (payload, callback) => {
    itemsCol.insertOne(payload, callback);
  };
};

module.exports.ItemsDAO = ItemsDAO;
