const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Friends list
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT f.id AS friendship_id, u.id, u.username, u.display_name
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status = 'accepted'
       ORDER BY u.username`,
      [req.userId]
    );
    res.json({ friends: result.rows });
  } catch (err) {
    next(err);
  }
});

// Pending requests: incoming and outgoing
router.get('/requests', async (req, res, next) => {
  try {
    const incoming = await pool.query(
      `SELECT f.id, u.id AS user_id, u.username, u.display_name, f.created_at
       FROM friendships f JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.userId]
    );
    const outgoing = await pool.query(
      `SELECT f.id, u.id AS user_id, u.username, u.display_name, f.created_at
       FROM friendships f JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.userId]
    );
    res.json({ incoming: incoming.rows, outgoing: outgoing.rows });
  } catch (err) {
    next(err);
  }
});

// Send a friend request by username
router.post('/request', async (req, res, next) => {
  try {
    const { username } = req.body || {};
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Invalid username' });
    }

    const target = await pool.query('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
    if (target.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const targetId = target.rows[0].id;
    if (targetId === req.userId) return res.status(400).json({ error: "You can't add yourself" });

    const existing = await pool.query(
      `SELECT id, requester_id, status FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [req.userId, targetId]
    );

    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      if (row.status === 'accepted') return res.status(409).json({ error: 'Already friends' });
      if (row.requester_id === req.userId) return res.status(409).json({ error: 'Request already sent' });
      // They already asked us, so sending one back accepts it
      await pool.query(
        "UPDATE friendships SET status = 'accepted', responded_at = now() WHERE id = $1",
        [row.id]
      );
      return res.json({ status: 'accepted' });
    }

    await pool.query(
      'INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)',
      [req.userId, targetId]
    );
    res.status(201).json({ status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// Accept a request someone sent you
router.post('/requests/:id/accept', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid request id' });
    const result = await pool.query(
      `UPDATE friendships SET status = 'accepted', responded_at = now()
       WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
       RETURNING id`,
      [req.params.id, req.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Request not found' });
    res.json({ status: 'accepted' });
  } catch (err) {
    next(err);
  }
});

// Decline a request, cancel one you sent, or remove a friend (by friendship id)
router.delete('/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const result = await pool.query(
      `DELETE FROM friendships
       WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)
       RETURNING id`,
      [req.params.id, req.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
