const DocsDAO = function (db) {
  const docsCol = db.collection('docs');

  // The filter is an object whose KEY is ownership-named and whose VALUE is a
  // plain identifier — syntactically identical to an ownership assertion.
  this.byUser = (userId, callback) => {
    docsCol.find({ userId: userId }).toArray(callback);
  };
};

module.exports.DocsDAO = DocsDAO;
