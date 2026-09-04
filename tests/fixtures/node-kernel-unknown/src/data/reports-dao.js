const ReportsDAO = function (db) {
  const reportsCol = db.collection('reports');

  this.getById = (reportId, callback) => {
    reportsCol.findOne({ kind: 'report' }, callback);
  };
};

module.exports.ReportsDAO = ReportsDAO;
