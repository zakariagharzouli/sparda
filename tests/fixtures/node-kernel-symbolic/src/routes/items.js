const ItemsDAO = require('../data/items-dao').ItemsDAO;

function ItemsHandler(db) {
  const itemsDAO = new ItemsDAO(db);

  this.createItem = (req, res, next) => {
    itemsDAO.create(req.body, (err) => {
      if (err) return next(err);
      return res.json({ ok: true });
    });
  };
}

module.exports = ItemsHandler;
