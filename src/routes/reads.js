const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const requireMember = require('../middleware/membership');

const router = express.Router({ mergeParams: true });

router.post('/read', requireAuth, requireMember, async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
      [req.conversationId, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/read-status', requireAuth, requireMember, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id AS user_id, u.username, m.last_read_at
       FROM conversation_members m JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = $1 ORDER BY u.username`,
      [req.conversationId]
    );
    res.json({ members: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
