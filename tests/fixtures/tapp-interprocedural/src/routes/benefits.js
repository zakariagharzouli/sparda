// The handler FACTORY: a constructor function that builds its DAO from the `db`
// it was given. The receiver of every DAO call below is that instance — resolved
// structurally, never by its name.
const { BenefitsDAO } = require('../data/benefits-dao');
const { OrdersDAO } = require('../data/orders-dao');

function BenefitsHandler(db) {
  const benefitsDAO = new BenefitsDAO(db);
  const ordersDAO = new OrdersDAO(db);

  // THE TARGET TRAJECTORY.
  // req.body → static destructuring → positional argument → DAO parameter →
  // Mongo filter and data, across two files.
  this.updateBenefits = (req, res, next) => {
    const { userId, benefitStartDate } = req.body;
    benefitsDAO.updateBenefits(userId, benefitStartDate, (error) => {
      if (error) return next(error);
      return res.json({ ok: true });
    });
  };

  // ARGUMENT ORDER, not argument NAME — and the two are deliberately CROSSED.
  // The caller's local `orderId` is passed at position 0, where the callee's
  // parameter is named `note`; the caller's `note` is passed at position 1, where
  // the parameter is named `orderId`. Every name here points at the wrong slot, so
  // a binding that matched on names would agree with itself and be wrong twice.
  this.placeOrder = (req, res) => {
    const orderId = req.params.id;
    const note = req.body.note;
    ordersDAO.place(orderId, note, () => res.json({ ok: true }));
  };

  // TWO ROUTES, ONE DAO METHOD, TWO SURFACES. Neither may inherit the other's
  // provenance: one takes its owner from the path, the other from the query.
  this.byPathOwner = (req, res) => {
    benefitsDAO.findByOwner(req.params.owner, (e, u) => res.json(u));
  };
  this.byQueryOwner = (req, res) => {
    benefitsDAO.findByOwner(req.query.owner, (e, u) => res.json(u));
  };

  // A PARAMETER REASSIGNED in the callee body. The effect is real; the hop is not
  // statable, because the value written is not the value passed.
  this.rewrite = (req, res) => {
    benefitsDAO.rewrite(req.body.tag, () => res.json({ ok: true }));
  };

  // A SPREAD argument: no position is determined, so no parameter is bound —
  // including the ones that LOOK safe. Argument 0 here is a plain request member,
  // and it is still refused, because a rule that binds "the positions before the
  // spread" is one edit away from binding the ones after it.
  this.spread = (req, res) => {
    const rest = [req.body.benefitStartDate, () => res.json({ ok: true })];
    benefitsDAO.updateBenefits(req.body.userId, ...rest);
  };

  // A REST parameter on the callee side: the same ambiguity, declared on the
  // other end of the seam.
  this.rest = (req, res) => {
    benefitsDAO.withRest(req.query.first, () => res.json({ ok: true }));
  };

  // A MULTI-ARGUMENT inline call in the destination. `combine(a, b)` is not a
  // function of `a` alone, so a path through it would apportion to one input a
  // value both produced.
  this.combined = (req, res) => {
    benefitsDAO.combine(req.query.k, () => res.json({ ok: true }));
  };

  // Two parameters of the same name: the position no longer identifies a binding.
  this.duplicate = (req, res) => {
    benefitsDAO.duplicate(req.query.a, req.query.b, () => res.json({ ok: true }));
  };

  // A method that does not exist on the resolved instance: the receiver resolved,
  // the member did not. That is a real behavioural hop ending in a declared stop.
  this.missing = (req, res) => {
    benefitsDAO.notThere(req.body.userId, () => res.json({ ok: true }));
  };

  // A COMPUTED method name: the callee is not readable.
  this.computed = (req, res) => {
    const m = req.query.method;
    benefitsDAO[m](req.body.userId, req.body.startDate, () => res.json({ ok: true }));
  };

  // An UNRESOLVED receiver: `missingDAO` is captured from nowhere this walk can open.
  this.unresolved = (req, res) => {
    missingDAO.updateBenefits(req.body.userId, req.body.startDate, () => res.json({}));
  };
}

module.exports = BenefitsHandler;
