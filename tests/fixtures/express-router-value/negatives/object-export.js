// 2. OBJECT export: a plain object is not a Router. It has no route table, and
// treating it as one would invent every path under it.
const handlers = {
  list: (req, res) => res.json([]),
  create: (req, res) => res.json({}),
};
module.exports = handlers;
