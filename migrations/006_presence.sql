ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;
ALTER TABLE conversation_members ADD COLUMN typing_until TIMESTAMPTZ;
