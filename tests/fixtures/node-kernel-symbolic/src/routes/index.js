const ItemsHandler = require('./items');

const index = (app, db) => {
  const itemsHandler = new ItemsHandler(db);
  app.post('/items/:kind', itemsHandler.createItem);
};

module.exports = index;
