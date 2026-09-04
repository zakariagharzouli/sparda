// The pre-2018 Node DAO: a constructor FUNCTION that captures its collection
// handle in the constructor scope and hangs arrow methods off `this`. This is the
// shape NodeGoat is written in, and the shape the interprocedural hop has to
// survive: the request value arrives as a positional PARAMETER, and the effect
// happens in this body before any callback runs.
function joinWith(a, b) {
  return `${a}:${b}`;
}

function BenefitsDAO(db) {
  const usersCol = db.collection('users');

  this.updateBenefits = (userId, startDate, callback) => {
    usersCol.update(
      { _id: parseInt(userId) },
      { $set: { benefitStartDate: startDate } },
      (err, result) => callback(err, result),
    );
  };

  // the SAME method reached from two routes — neither may inherit the other's proof
  this.findByOwner = (ownerId, callback) => {
    usersCol.findOne({ owner: ownerId }, callback);
  };

  // a REST parameter: "position i" no longer means one argument, so no position
  // in this signature is safe to bind
  this.withRest = (first, ...others) => {
    usersCol.findOne({ first }, others);
  };

  // the transform takes TWO inputs: its output is not a function of `key` alone
  this.combine = (key, callback) => {
    usersCol.findOne({ tag: joinWith(key, 'suffix') }, callback);
  };

  // DUPLICATE parameter names. Legal in a sloppy-mode function expression, and
  // the later one wins — so "the value at position 0" and "the value bound to
  // `dup`" are two different things, and the seam cannot say which reached the
  // effect.
  this.duplicate = function (dup, dup, callback) {
    usersCol.findOne({ dup }, callback);
  };

  // a parameter REASSIGNED before the effect: the value written is not the value
  // that was passed, so the hop may not be stated
  this.rewrite = (tag, callback) => {
    tag = 'constant';
    usersCol.update({ tag }, { $set: { tag } }, callback);
  };
}

module.exports = { BenefitsDAO };
