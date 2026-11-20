-- Sign-in state that must work exactly once (#178 review): the challenge of each WebAuthn
-- ceremony and each started Google sign-in. They lived in KV, whose get-then-delete is neither
-- atomic nor consistent across locations; in D1 a `DELETE ... RETURNING` takes a row once.
-- Neither belongs to a user yet when it is made (a sign-in names no one until it is answered), so
-- there is no user_id: what a row is for, including the user id of an add-passkey ceremony, is in
-- its JSON, and the code checks it. Expired rows are deleted on each new write.
CREATE TABLE passkey_challenges (
  id TEXT PRIMARY KEY,
  -- The challenge and what it is for, as JSON.
  challenge TEXT NOT NULL,
  -- Epoch milliseconds.
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX passkey_challenges_expires_at_idx ON passkey_challenges (expires_at);

CREATE TABLE google_flows (
  -- The OAuth state of the sign-in.
  state TEXT PRIMARY KEY,
  -- The PKCE verifier, the nonce, the binding cookie's hash and what the sign-in is for, as JSON.
  flow TEXT NOT NULL,
  -- Epoch milliseconds.
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX google_flows_expires_at_idx ON google_flows (expires_at);
