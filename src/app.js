const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.use('/api/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/conversations', require('./routes/conversations'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

module.exports = app;
