// `require` is a PARAMETER here, not the host's require. At runtime this mounts
// whatever the caller passes; the `./routes` module is never loaded. Reading the
// call as a module load would report a route the server does not serve and miss
// the one it does — a name is not a proof of origin.
const express = require('express');
const app = express();

function mount(require) {
  app.use('/api', require('./routes'));
}

mount(() => {
  const r = express.Router();
  r.get('/decoy', (q, s) => s.json({}));
  return r;
});

app.post('/local', (req, res) => res.json({}));
app.listen(3000);
module.exports = app;
