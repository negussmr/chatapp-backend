const pool = require('../db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireMember(req, res, next) {
  try {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Conversation not found' });

    const result = await pool.query(
      'SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Conversation not found' });

    req.conversationId = id;
    req.memberRole = result.rows[0].role;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = requireMember;
