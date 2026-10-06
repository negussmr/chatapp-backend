const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2 || q.length > 20) {
      return res.status(400).json({ error: 'Search must be 2-20 characters' });
    }
    // Escape LIKE wildcards so users can't search with % or _
    const pattern = q.replace(/[\\%_]/g, '\\$&') + '%';
    const result = await pool.query(
      `SELECT id, username, display_name FROM users
       WHERE lower(username) LIKE lower($1) AND id <> $2
       ORDER BY username LIMIT 20`,
      [pattern, req.userId]
    );
    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
});

router.put('/me', async (req, res, next) => {
  try {
    const { display_name } = req.body || {};
    if (typeof display_name !== 'string' || !display_name.trim() || display_name.trim().length > 50) {
      return res.status(400).json({ error: 'Display name must be 1-50 characters' });
    }
    const result = await pool.query(
      'UPDATE users SET display_name = $1 WHERE id = $2 RETURNING id, username, display_name',
      [display_name.trim(), req.userId]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const result = await pool.query(
      'SELECT id, username, display_name FROM users WHERE id = $1',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
