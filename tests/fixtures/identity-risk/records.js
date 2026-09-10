function Records(db) {
  const rows = db.collection('records');
  this.read = (req, res) => {
    const actor = req.params.actor;
    rows.find({ _id: actor }).toArray((err, values) => res.json(values));
  };
}
module.exports = Records;
