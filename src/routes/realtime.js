const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const requireMember = require('../middleware/membership');
const { SELECT_MESSAGE } = require('./messages');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mounted at /api/conversations/:id
const conversationRealtime = express.Router({ mergeParams: true });
conversationRealtime.use(requireAuth, requireMember);

// Call this while the user is typing. It expires on its own after 5 seconds.
conversationRealtime.post('/typing', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE conversation_members SET typing_until = now() + interval '5 seconds'
       WHERE conversation_id = $1 AND user_id = $2`,
      [req.conversationId, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// One call every few seconds: new messages + who's typing/online/read
conversationRealtime.get('/poll', async (req, res, next) => {
  try {
    // Heartbeat: only writes if the last one is stale, to avoid a write on every poll
    await pool.query(
      `UPDATE users SET last_seen_at = now()
       WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '20 seconds')`,
      [req.userId]
    );

    let messages = [];
    const after = req.query.after;
    if (after !== undefined) {
      if (typeof after !== 'string' || !UUID_RE.test(after)) {
        return res.status(400).json({ error: 'Invalid after id' });
      }
      const result = await pool.query(
        `${SELECT_MESSAGE}
         WHERE m.conversation_id = $1
           AND (m.created_at, m.id) > (SELECT created_at, id FROM messages WHERE id = $2 AND conversation_id = $1)
         ORDER BY m.created_at ASC, m.id ASC
         LIMIT 50`,
        [req.conversationId, after]
      );
      messages = result.rows;
    }

    const members = await pool.query(
      `SELECT u.id AS user_id, u.username,
              COALESCE(u.last_seen_at > now() - interval '60 seconds', false) AS online,
              COALESCE(m.typing_until > now(), false) AS typing,
              m.last_read_at
       FROM conversation_members m JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = $1 AND m.user_id <> $2`,
      [req.conversationId, req.userId]
    );

    res.json({ messages, members: members.rows });
  } catch (err) {
    next(err);
  }
});

// Mounted at /api/unread: for the chat list screen
const unread = express.Router();
unread.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.conversation_id,
              (SELECT count(*)::int FROM messages x
               WHERE x.conversation_id = m.conversation_id
                 AND x.sender_id IS DISTINCT FROM $1
                 AND x.deleted_at IS NULL
                 AND (m.last_read_at IS NULL OR x.created_at > m.last_read_at)) AS unread,
              (SELECT max(created_at) FROM messages WHERE conversation_id = m.conversation_id) AS last_message_at
       FROM conversation_members m
       WHERE m.user_id = $1`,
      [req.userId]
    );
    res.json({ conversations: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = { conversationRealtime, unread };
