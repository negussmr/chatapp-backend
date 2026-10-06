const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const requireMember = require('../middleware/membership');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns which of the given user ids are accepted friends of the current user
async function friendsAmong(userId, ids) {
  const result = await pool.query(
    `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
     FROM friendships
     WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)
       AND (CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END) = ANY($2::uuid[])`,
    [userId, ids]
  );
  return result.rows.map((r) => r.friend_id);
}

router.post('/', async (req, res, next) => {
  try {
    const { type, user_id, title, member_ids } = req.body || {};

    if (type === 'direct') {
      if (typeof user_id !== 'string' || !UUID_RE.test(user_id) || user_id === req.userId) {
        return res.status(400).json({ error: 'Invalid user_id' });
      }
      if ((await friendsAmong(req.userId, [user_id])).length !== 1) {
        return res.status(403).json({ error: 'You can only chat with friends' });
      }

      const key = [req.userId, user_id].sort().join(':');
      const existing = await pool.query('SELECT id FROM conversations WHERE direct_key = $1', [key]);
      if (existing.rowCount > 0) return res.json({ id: existing.rows[0].id, existing: true });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const conv = await client.query(
          `INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct', $1, $2)
           ON CONFLICT (direct_key) DO NOTHING RETURNING id`,
          [key, req.userId]
        );
        if (conv.rowCount === 0) {
          await client.query('ROLLBACK');
          const again = await pool.query('SELECT id FROM conversations WHERE direct_key = $1', [key]);
          return res.json({ id: again.rows[0].id, existing: true });
        }
        const id = conv.rows[0].id;
        await client.query(
          'INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)',
          [id, req.userId, user_id]
        );
        await client.query('COMMIT');
        return res.status(201).json({ id, existing: false });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    if (type === 'group') {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 50) {
        return res.status(400).json({ error: 'Title must be 1-50 characters' });
      }
      if (!Array.isArray(member_ids) || member_ids.length < 1 || member_ids.length > 49 ||
          !member_ids.every((m) => typeof m === 'string' && UUID_RE.test(m))) {
        return res.status(400).json({ error: 'member_ids must be 1-49 user ids' });
      }
      const ids = [...new Set(member_ids)].filter((m) => m !== req.userId);
      if (ids.length === 0) return res.status(400).json({ error: 'Add at least one other person' });
      if ((await friendsAmong(req.userId, ids)).length !== ids.length) {
        return res.status(403).json({ error: 'You can only add friends to a group' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const conv = await client.query(
          "INSERT INTO conversations (type, title, created_by) VALUES ('group', $1, $2) RETURNING id",
          [title.trim(), req.userId]
        );
        const id = conv.rows[0].id;
        await client.query(
          "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'admin')",
          [id, req.userId]
        );
        await client.query(
          "INSERT INTO conversation_members (conversation_id, user_id) SELECT $1, unnest($2::uuid[])",
          [id, ids]
        );
        await client.query('COMMIT');
        return res.status(201).json({ id });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    res.status(400).json({ error: "type must be 'direct' or 'group'" });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.type, c.title, c.created_at,
              o.id AS other_user_id, o.username AS other_username, o.display_name AS other_display_name
       FROM conversation_members m
       JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN conversation_members om
         ON om.conversation_id = c.id AND om.user_id <> $1 AND c.type = 'direct'
       LEFT JOIN users o ON o.id = om.user_id
       WHERE m.user_id = $1
       ORDER BY c.created_at DESC`,
      [req.userId]
    );
    res.json({ conversations: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireMember, async (req, res, next) => {
  try {
    const conv = await pool.query(
      'SELECT id, type, title, created_at FROM conversations WHERE id = $1',
      [req.conversationId]
    );
    const members = await pool.query(
      `SELECT u.id, u.username, u.display_name, m.role
       FROM conversation_members m JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = $1 ORDER BY u.username`,
      [req.conversationId]
    );
    res.json({ conversation: conv.rows[0], members: members.rows, my_role: req.memberRole });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
