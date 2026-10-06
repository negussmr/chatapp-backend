const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');

const router = express.Router();

router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later' },
}));

const REFRESH_DAYS = 30;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function makeAccessToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(48).toString('hex');
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, hashToken(token), REFRESH_DAYS]
  );
  return token;
}

async function sendSession(res, status, user) {
  res.status(status).json({
    user: { id: user.id, username: user.username, display_name: user.display_name },
    access_token: makeAccessToken(user.id),
    refresh_token: await issueRefreshToken(user.id),
  });
}

router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password, display_name } = req.body || {};

    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or underscores' });
    }
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: 'Password must be 8-72 characters' });
    }
    if (display_name !== undefined && (typeof display_name !== 'string' || display_name.length > 50)) {
      return res.status(400).json({ error: 'Display name must be 50 characters or less' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let user;
    try {
      const result = await pool.query(
        `INSERT INTO users (username, email, password_hash, display_name)
         VALUES ($1, $2, $3, $4) RETURNING id, username, display_name`,
        [username, email, passwordHash, display_name?.trim() || username]
      );
      user = result.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Username or email already taken' });
      }
      throw err;
    }

    await sendSession(res, 201, user);
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { login, password } = req.body || {};
    if (typeof login !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'login and password are required' });
    }

    const result = await pool.query(
      `SELECT id, username, display_name, password_hash FROM users
       WHERE lower(username) = lower($1) OR lower(email) = lower($1)`,
      [login]
    );
    const user = result.rows[0];

    // Always run bcrypt so response time doesn't reveal whether the account exists
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      return res.status(401).json({ error: 'Wrong username or password' });
    }

    await sendSession(res, 200, user);
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body || {};
    if (typeof refresh_token !== 'string') {
      return res.status(400).json({ error: 'refresh_token is required' });
    }

    // Revoke the old token and read its owner in one step, so it can only be used once
    const used = await pool.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [hashToken(refresh_token)]
    );
    if (used.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const userId = used.rows[0].user_id;
    res.json({
      access_token: makeAccessToken(userId),
      refresh_token: await issueRefreshToken(userId),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const { refresh_token } = req.body || {};
    if (typeof refresh_token === 'string') {
      await pool.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
        [hashToken(refresh_token)]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, display_name, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
