// semantic-linker.test.js — deterministic cross-file Express setup binding.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractExpress } from '../src/ubg/express.js';

function withProject(files, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-semantic-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      const target = path.join(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, source);
    }
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('semantic linker — CommonJS setup modules', () => {
  it('binds an Express instance through direct and imported setup calls', () => {
    const extracted = withProject(
      {
        'server.js': `const express = require('express');
const app = express();
require('./routes/direct')(app);
const register = require('./routes/imported');
register(app);
module.exports = app;
`,
        'routes/direct.js': `module.exports = function (server) {
  const api = server;
  api.get('/login', (req, res) => res.send('ok'));
};
`,
        'routes/imported.js': `function register(api) {
  api.post('/session', (req, res) => res.status(201).send('created'));
}
module.exports = register;
`,
      },
      (root) => extractExpress(root, 'server.js'),
    );

    expect(
      extracted.routes.map(({ method, path: routePath }) => [method, routePath]),
    ).toEqual([
      ['get', '/login'],
      ['post', '/session'],
    ]);
    expect(extracted.unknownHandlers).toEqual([]);
  });

  it('binds a stored CommonJS factory from a callback, preserving the app argument position', () => {
    const extracted = withProject(
      {
        'server.js': `const express = require('express');
const app = express();
const register = require('./routes');
connectDatabase((err, db) => {
  if (err) throw err;
  register(app, db);
});
module.exports = app;
`,
        'routes.js': `module.exports = function (server, db) {
  server.post('/benefits', (req, res) => res.status(201).send('created'));
};
`,
      },
      (root) => extractExpress(root, 'server.js'),
    );

    expect(
      extracted.routes.map(({ method, path: routePath }) => [method, routePath]),
    ).toEqual([['post', '/benefits']]);
    expect(extracted.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ risk: 'high' })]),
    );
  });

  it('resolves CommonJS constructor members and a local middleware alias inside the factory', () => {
    const extracted = withProject(
      {
        'server.js': `const express = require('express');
const app = express();
const register = require('./routes');
afterConnect((db) => {
  register(app, db);
});
module.exports = app;
`,
        'routes.js': `const Handler = require('./handler');
module.exports = function (server, db) {
  const handler = new Handler(db);
  const requireLogin = handler.requireLogin;
  server.post('/benefits', requireLogin, handler.updateBenefits);
};
`,
        'handler.js': `function Handler(db) {
  this.requireLogin = (req, res, next) => {
    if (!req.user) return res.status(401).send('no');
    return next();
  };
  this.updateBenefits = (req, res) => {
    return User.updateOne(req.body);
  };
}
module.exports = Handler;
`,
      },
      (root) => extractExpress(root, 'server.js'),
    );

    const route = extracted.routes.find(
      ({ method, path: routePath }) => method === 'post' && routePath === '/benefits',
    );
    expect(route?.chain.map((step) => step.name)).toEqual([
      'handler.requireLogin',
      'handler.updateBenefits',
    ]);
    expect(route?.chain.every((step) => step.fn)).toBe(true);
    expect(route?.chain[1].scan.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ effectType: 'db_write' })]),
    );
  });

  it('declares an unbindable setup call instead of silently reporting zero routes', () => {
    const extracted = withProject(
      {
        'server.js': `const express = require('express');
const app = express();
require('./routes/opaque')(app);
module.exports = app;
`,
        'routes/opaque.js': `module.exports = function () {
  // The callee receives an Express object, but has no statically bindable parameter.
};
`,
      },
      (root) => extractExpress(root, 'server.js'),
    );

    expect(extracted.routes).toEqual([]);
    expect(extracted.unknownHandlers).toEqual([
      expect.objectContaining({
        kind: 'UnknownHandler',
        target: "require('./routes/opaque')",
        via: 'module-setup-unresolvable',
      }),
    ]);
    expect(extracted.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ risk: 'high' })]),
    );
  });
});
