// ubg/kernel/contracts.js — declarative contracts: calls → facts.
//
// A contract is a DECLARATION about a library's API surface, not a heuristic
// about a program. It answers exactly one question — "what does this call do to
// state?" — and it is allowed exactly one kind of answer: a fact. A contract
// may never conclude that a route, a guard or an application is safe; the most
// it can say is that a call is a read, a write, or something it does not model.
//
// The separation matters because a contract is the only place a NAME is trusted
// in the kernel, and it is trusted about a LIBRARY (`Collection.updateOne` is a
// write — that is MongoDB's documented API), never about user code. A guard is
// never recognised this way; `guardBoundaryProof` requires structure.
//
// Sources for the op tables are recorded in docs/THIRD-PARTY-ANALYSIS-SOURCES.md
// with their version pins. No external engine is required at runtime.

// MongoDB Node driver, `Collection` methods. The legacy trio (`update`,
// `insert`, `remove`) is deliberately present: it is deprecated upstream and
// still what a large body of real Node code calls — NodeGoat's whole write path
// goes through `usersCol.update(...)`, and a table that only knew the modern
// names read that application as having no writes at all.
//
// Scoped to a receiver PROVEN to be a collection handle (`db.collection('x')`
// resolved through kernel/bindings.js). This is why the legacy names are safe to
// include here and would not be safe in the global active-record table: a bare
// `.update()` on an unknown receiver still yields nothing.
export const MONGO_COLLECTION_OPS = Object.freeze({
  // reads
  find: 'select',
  findone: 'select',
  countdocuments: 'select',
  estimateddocumentcount: 'select',
  count: 'select',
  distinct: 'select',
  aggregate: 'select',
  // writes — insert
  insertone: 'insert',
  insertmany: 'insert',
  insert: 'insert', // legacy driver
  // writes — update
  updateone: 'update',
  updatemany: 'update',
  update: 'update', // legacy driver
  replaceone: 'update',
  findoneandupdate: 'update',
  findoneandreplace: 'update',
  findandmodify: 'update', // legacy driver
  save: 'upsert', // legacy driver
  bulkwrite: 'update',
  // writes — delete
  deleteone: 'delete',
  deletemany: 'delete',
  remove: 'delete', // legacy driver
  findoneanddelete: 'delete',
  drop: 'delete',
});

// A write whose filter selects rows is an UPDATE of an existing set; a write
// with no filter is unbounded. Kept as data so `DbEffect` can carry the
// distinction rather than each call site re-deriving it.
export const MONGO_FILTERED_OPS = Object.freeze(
  new Set(['update', 'delete', 'upsert', 'select']),
);

// Which argument position carries the FILTER, and which carries the MODIFIED
// DATA, per op. `null` means the op has no such argument. This is what lets a
// DbEffect say "this write is selected by req.body.userId" instead of only
// "this is a write".
export const MONGO_ARG_ROLES = Object.freeze({
  find: { filter: 0, data: null },
  findone: { filter: 0, data: null },
  countdocuments: { filter: 0, data: null },
  distinct: { filter: 1, data: null },
  deleteone: { filter: 0, data: null },
  deletemany: { filter: 0, data: null },
  remove: { filter: 0, data: null },
  findoneanddelete: { filter: 0, data: null },
  updateone: { filter: 0, data: 1 },
  updatemany: { filter: 0, data: 1 },
  update: { filter: 0, data: 1 },
  replaceone: { filter: 0, data: 1 },
  findoneandupdate: { filter: 0, data: 1 },
  findoneandreplace: { filter: 0, data: 1 },
  findandmodify: { filter: 0, data: 2 },
  insertone: { filter: null, data: 0 },
  insertmany: { filter: null, data: 0 },
  insert: { filter: null, data: 0 },
  save: { filter: null, data: 0 },
});

// The registry. Every contract states what it models AND what it does not, so
// an unmodelled library is a declared gap rather than a silent zero. `modelled:
// false` entries exist to be counted by docs/NODE-INTELLIGENCE-GAP-MAP.md —
// removing one without implementing it would quietly shrink the known subject.
export const CONTRACTS = Object.freeze([
  {
    id: 'express/router',
    layer: 'http',
    modelled: true,
    emits: ['DataSource', 'GuardBoundary'],
    note: 'route registration, middleware chain and mount prefixes',
  },
  {
    id: 'mongo/driver',
    layer: 'persistence',
    modelled: true,
    emits: ['DbEffect'],
    note: 'Collection handles captured from db.collection(<literal>)',
  },
  {
    id: 'mongoose/model',
    layer: 'persistence',
    modelled: true,
    emits: ['DbEffect'],
    note: 'active-record Model.op() — shared table with TypeORM/Sequelize',
  },
  {
    id: 'sql/builder',
    layer: 'persistence',
    modelled: true,
    emits: ['DbEffect'],
    note: 'knex/pg/drizzle builders and raw SQL',
  },
  {
    id: 'node/callback',
    layer: 'async',
    modelled: true,
    emits: ['AsyncContinuation'],
    note: 'await, .then/.catch, and positional (err, value) callbacks',
  },
  {
    id: 'node/resolve',
    layer: 'resolution',
    modelled: true,
    emits: ['UnknownBoundary'],
    note: 'every hop the interprocedural walk could not complete',
  },
  // Declared, NOT modelled. Slice order is fixed by the mission: these come
  // after the Express/Mongo/SQL slice is complete, tested and benchmarked.
  {
    id: 'prisma/client',
    layer: 'persistence',
    modelled: false,
    emits: [],
    note: 'partially covered by the pre-kernel extractor; no kernel facts yet',
  },
  {
    id: 'fastify/router',
    layer: 'http',
    modelled: false,
    emits: [],
    note: 'not modelled — no Fastify lowering exists yet',
  },
  {
    id: 'nest/controller',
    layer: 'http',
    modelled: false,
    emits: [],
    note: 'lowering exists; kernel facts not wired to it yet',
  },
  {
    id: 'node/queue',
    layer: 'async',
    modelled: false,
    emits: [],
    note: 'producer/consumer pairs are only followed when both are static',
  },
]);

export const modelledContracts = () => CONTRACTS.filter((c) => c.modelled);
export const declaredGaps = () => CONTRACTS.filter((c) => !c.modelled);
