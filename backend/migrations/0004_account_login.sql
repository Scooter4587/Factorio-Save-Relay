ALTER TABLE users ADD COLUMN login_name TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN recovery_hash TEXT;

CREATE UNIQUE INDEX idx_users_login_name ON users(login_name) WHERE login_name IS NOT NULL;

CREATE TABLE auth_attempts (
    key_hash TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_start TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
