-- The Connect page (#139): what each device did last, and extension pairing.
--
-- `api_tokens.last_used_at`: when the token last authenticated a request. The auth middleware
-- writes it at most once a minute per token.
ALTER TABLE api_tokens ADD COLUMN last_used_at TEXT;

-- The device's latest save, a repeat save of a stored URL included: when, and which link. Written
-- by the links feature on every save attributed to the device. No foreign key, so deleting the
-- link only leaves a dangling id, which the activity query joins away.
ALTER TABLE devices ADD COLUMN last_save_at TEXT;
ALTER TABLE devices ADD COLUMN last_save_link_id TEXT;

-- An approved extension pairing: the SHA-256 of the one-time code the extension claims its device
-- token with, the device it binds to, and when the approval lapses. Claiming deletes the row.
CREATE TABLE device_pairings (
  code_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
