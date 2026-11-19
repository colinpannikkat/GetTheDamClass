-- The first version of the database. D1 is SQLite, so this is SQLite's SQL.
--
-- Migrations run in the order of their file names, each once. Never edit one
-- that has already run somewhere: add a new file instead. To apply them, see
-- "Server" in the README.
--
-- Times are milliseconds since 1970 (UTC), as JavaScript's Date.now() gives
-- them. Email addresses are stored trimmed and in lower case, the way the API
-- hands them over (`EmailAddress` in packages/shared).

-- One account per email address.
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- The sign-in code last sent to each address, whether or not an account
-- exists for it yet: an account is only created once a code is confirmed.
-- A new code replaces the old one. Only a hash of the code is kept.
CREATE TABLE sign_in_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  -- When it was sent. Both time limits (one code a minute, 15 minutes to use
  -- it) are counted from here.
  sent_at INTEGER NOT NULL,
  -- How many times someone tried a code for this address since it was sent.
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Sign-in tokens: one for each browser that signed in. Only a hash of the
-- token is kept, so a copy of the database signs nobody in.
CREATE TABLE tokens (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  -- Kept roughly up to date (at most one write a day) so that tokens nobody
  -- has used for a long time can be removed.
  last_used_at INTEGER NOT NULL
);
CREATE INDEX tokens_by_account ON tokens (account_id);

-- Every class somebody watches (or watched; a row can outlive its alerts):
-- its title, and whether it had a free seat when last looked at.
CREATE TABLE classes (
  term TEXT NOT NULL,
  crn TEXT NOT NULL,
  title TEXT NOT NULL,
  -- 1 when fewer students were enrolled than the class allows, else 0.
  vacant INTEGER NOT NULL,
  PRIMARY KEY (term, crn)
);

-- Who gets alerts for which class.
CREATE TABLE alerts (
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  crn TEXT NOT NULL,
  -- The secret in this alert's unsubscribe link. Unlike sign-in tokens it is
  -- kept as it is, not hashed: every email about the class carries the link
  -- again, and all it can do is stop this one alert.
  unsubscribe_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, term, crn),
  FOREIGN KEY (term, crn) REFERENCES classes (term, crn)
);
-- For finding everybody who watches one class.
CREATE INDEX alerts_by_class ON alerts (term, crn);
