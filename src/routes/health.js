const express = require('express');
const pool = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

router.get('/db', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (err) {
    console.error('DB health check failed:', err.message);
    res.status(503).json({ ok: false, error: 'Database unavailable' });
  }
});

module.exports = router;
