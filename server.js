const express = require('express');
const path = require('path');
const { initDb } = require('./utils/db');

const lookupRouter = require('./routes/lookup');
const casesRouter = require('./routes/cases');
const reportsRouter = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/lookup', lookupRouter);
app.use('/api/cases', casesRouter);
app.use('/api/reports', reportsRouter);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb();
app.listen(PORT, () => {
  console.log(`OSINT Dashboard running at http://localhost:${PORT}`);
});
