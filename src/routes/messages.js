const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const requireMember = require('../middleware/membership');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_MESSAGE = `
  SELECT m.id, m.conversation_id, m.sender_id,
         u.username AS sender_username, u.display_name AS sender_display_name,
         CASE WHEN m.deleted_at IS NULL THEN m.body END AS body,
         m.reply_to_id,
         CASE WHEN r.deleted_at IS NULL THEN left(r.body, 100) END AS reply_preview,
         m.created_at, m.edited_at, (m.deleted_at IS NOT NULL) AS deleted,
         COALESCE((SELECT json_object_agg(reaction, cnt) FROM (SELECT reaction, count(*)::int AS cnt FROM message_reactions WHERE message_id = m.id GROUP BY reaction) x), '{}'::json) AS reactions
  FROM messages m
  LEFT JOIN users u ON u.id = m.sender_id
  LEFT JOIN messages r ON r.id = m.reply_to_id`;

async function getMessage(id) {
  const result = await pool.query(`${SELECT_MESSAGE} WHERE m.id = $1`, [id]);
  return result.rows[0];
}

function cleanBody(body) {
  if (typeof body !== 'string') return null;
  const text = body.trim();
  return text.length >= 1 && text.length <= 4000 ? text : null;
}

// Mounted at /api/conversations/:id/messages
const conversationMessages = express.Router({ mergeParams: true });
conversationMessages.use(requireAuth, requireMember);

conversationMessages.get('/', async (req, res, next) => {
  try {
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) limit = 30;
    limit = Math.min(limit, 100);

    const params = [req.conversationId];
    let beforeClause = '';
    if (req.query.before !== undefined) {
      if (typeof req.query.before !== 'string' || !UUID_RE.test(req.query.before)) {
        return res.status(400).json({ error: 'Invalid before id' });
      }
      params.push(req.query.before);
      beforeClause = `AND (m.created_at, m.id) < (
        SELECT created_at, id FROM messages WHERE id = $2 AND conversation_id = $1)`;
    }
    params.push(limit);

    const result = await pool.query(
      `${SELECT_MESSAGE}
       WHERE m.conversation_id = $1 ${beforeClause}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $${params.length}`,
      params
    );
    const messages = result.rows;
    res.json({
      messages,
      next_before: messages.length === limit ? messages[messages.length - 1].id : null,
    });
  } catch (err) {
    next(err);
  }
});

conversationMessages.post('/', async (req, res, next) => {
  try {
    const { body, reply_to_id } = req.body || {};
    const text = cleanBody(body);
    if (!text) return res.status(400).json({ error: 'Message must be 1-4000 characters' });

    if (reply_to_id !== undefined && reply_to_id !== null) {
      if (typeof reply_to_id !== 'string' || !UUID_RE.test(reply_to_id)) {
        return res.status(400).json({ error: 'Invalid reply_to_id' });
      }
      const parent = await pool.query(
        'SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2',
        [reply_to_id, req.conversationId]
      );
      if (parent.rowCount === 0) {
        return res.status(400).json({ error: 'Reply target not found in this conversation' });
      }
    }

    const inserted = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, body, reply_to_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.conversationId, req.userId, text, reply_to_id || null]
    );
    res.status(201).json({ message: await getMessage(inserted.rows[0].id) });
  } catch (err) {
    next(err);
  }
});

// Mounted at /api/messages
const messageActions = express.Router();
messageActions.use(requireAuth);

// Edit or delete only works on your own messages, in conversations you still belong to
const OWN_MESSAGE = `
  id = $1 AND sender_id = $2 AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM conversation_members cm
              WHERE cm.conversation_id = messages.conversation_id AND cm.user_id = $2)`;

messageActions.put('/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Message not found' });
    const text = cleanBody((req.body || {}).body);
    if (!text) return res.status(400).json({ error: 'Message must be 1-4000 characters' });

    const result = await pool.query(
      `UPDATE messages SET body = $3, edited_at = now() WHERE ${OWN_MESSAGE} RETURNING id`,
      [req.params.id, req.userId, text]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Message not found' });
    res.json({ message: await getMessage(req.params.id) });
  } catch (err) {
    next(err);
  }
});

messageActions.delete('/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Message not found' });
    const result = await pool.query(
      `UPDATE messages SET body = '', deleted_at = now() WHERE ${OWN_MESSAGE} RETURNING id`,
      [req.params.id, req.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Message not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { conversationMessages, messageActions, SELECT_MESSAGE };
