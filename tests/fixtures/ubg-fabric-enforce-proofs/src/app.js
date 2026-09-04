// Fabric F5 fixture: imported authentication is asserted only. Enforcement must add a local
// guard that is present in this mutation route and constraining when the user is absent.
import express from 'express';
import { requireAuth } from 'some-unknown-auth-lib';
const app = express();
app.use(express.json());
const prisma = { post: { update: async () => null } };
app.post('/posts/:id', requireAuth, async (req, res) => {
  await prisma.post.update({ where: { id: req.params.id }, data: { title: req.body.title } });
  res.json({ ok: true });
});
app.listen(3000);
