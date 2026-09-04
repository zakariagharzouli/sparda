import express from 'express';

const app = express();
app.get('/bootstrap', (_req, res) => res.send('bootstrap'));
