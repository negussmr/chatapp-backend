const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED = ['like', 'love', 'laugh', 'wow', 'sad', 'thanks'];

router.post('/:id/react', requireAuth, async (req, res, next) => {
  try {
    const { reaction } = req.body || {};
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Message not found' });
    if (!ALLOWED.includes(reaction)) {
      return res.status(400).json({ error: `reaction must be one of: ${ALLOWED.join(', ')}` });
    }

    const msg = await pool.query(
      `SELECT 1 FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
       WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [req.params.id, req.userId]
    );
    if (msg.rowCount === 0) return res.status(404).json({ error: 'Message not found' });

    const existing = await pool.query(
      'SELECT reaction FROM message_reactions WHERE message_id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );

    if (existing.rowCount > 0 && existing.rows[0].reaction === reaction) {
      await pool.query(
        'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2',
        [req.params.id, req.userId]
      );
      return res.json({ reaction: null });
    }

    await pool.query(
      `INSERT INTO message_reactions (message_id, user_id, reaction) VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = now()`,
      [req.params.id, req.userId, reaction]
    );
    res.json({ reaction });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
