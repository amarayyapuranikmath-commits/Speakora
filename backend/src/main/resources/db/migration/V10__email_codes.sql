-- Short codes next to the emailed links, so the mobile app can verify an email address and reset a password without a deep link.
-- A code belongs to one token row (one email). It is stored only as a hash and dies after a few wrong guesses.
ALTER TABLE email_verification_tokens ADD COLUMN code_hash VARCHAR(64), ADD COLUMN failed_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE password_reset_tokens ADD COLUMN code_hash VARCHAR(64), ADD COLUMN failed_attempts INT NOT NULL DEFAULT 0;
