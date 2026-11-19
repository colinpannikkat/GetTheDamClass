-- The daily cap on sign-in emails (`SignInEmailsPerDay` in src/signIn.ts).
-- See 0001 for how migrations work.

-- How many sign-in code emails the server tried to send on each day: a
-- calendar day in UTC, as an ISO date ("2026-11-19"). Only a day and a
-- number, nothing about anyone. The daily cleanup removes days more than a
-- week old.
CREATE TABLE sign_in_emails (
  day TEXT PRIMARY KEY,
  sent INTEGER NOT NULL
);
