// A LOCAL module that exports its own `Router` factory. Every literal below reads
// exactly like the real thing; only the require specifier differs.
exports.Router = function Router() {
  return { get() {}, post() {}, use() {} };
};
