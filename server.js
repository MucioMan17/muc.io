const express = require('express');
const path = require('path');
const { initDb } = require('./utils/db');

const lookupRouter = require('./routes/lookup');
const { router: casesRouter } = require('./routes/cases');
const reportsRouter = require('./routes/reports');
const searchRouter = require('./routes/search');
const osintRouter = require('./routes/osint');

const app = express();
const PORT = process.env.PORT || 3000;

// Limit is generous so screenshots can be uploaded inline as base64.
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/lookup', lookupRouter);
app.use('/api/cases', casesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/search', searchRouter);
app.use('/api/osint', osintRouter);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// JSON error handler (e.g. payload too large) so the client gets a clean message.
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'File too large (max ~20MB).' });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

initDb();
app.listen(PORT, () => {
  console.log(`OSINT Dashboard running at http://localhost:${PORT}`);
});
