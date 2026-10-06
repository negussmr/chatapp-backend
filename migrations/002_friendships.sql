CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CHECK (requester_id <> addressee_id)
);

-- One friendship row per pair, no matter who sent the request
CREATE UNIQUE INDEX friendships_pair_idx
  ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX friendships_addressee_idx ON friendships (addressee_id, status);
CREATE INDEX friendships_requester_idx ON friendships (requester_id, status);
