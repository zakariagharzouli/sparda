import express from 'express';

const app = express();
app.get('/application', (_req, res) => res.send('application'));
