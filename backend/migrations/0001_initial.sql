PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE worlds (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
    locked_by_device_id TEXT,
    lock_token_hash TEXT,
    lock_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id),
    FOREIGN KEY (locked_by_device_id) REFERENCES devices(id)
);

CREATE TABLE world_members (
    world_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (world_id, user_id),
    FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE invites (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    redeemed_at TEXT,
    redeemed_by_user_id TEXT,
    FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
    FOREIGN KEY (redeemed_by_user_id) REFERENCES users(id)
);

CREATE TABLE revisions (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    base_revision_number INTEGER NOT NULL CHECK (base_revision_number >= 0),
    object_key TEXT NOT NULL UNIQUE,
    sha256 TEXT,
    file_size_bytes INTEGER CHECK (file_size_bytes > 0),
    uploaded_by_device_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploading'
        CHECK (status IN ('uploading', 'current', 'archived', 'conflict', 'pending_delete', 'deleted')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalized_at TEXT,
    UNIQUE (world_id, revision_number),
    FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by_device_id) REFERENCES devices(id)
);

CREATE INDEX idx_devices_user_id ON devices(user_id);
CREATE INDEX idx_world_members_user_id ON world_members(user_id);
CREATE INDEX idx_invites_world_id ON invites(world_id);
CREATE INDEX idx_revisions_world_number ON revisions(world_id, revision_number DESC);
CREATE INDEX idx_revisions_status ON revisions(status);
CREATE UNIQUE INDEX idx_revisions_one_current_per_world
    ON revisions(world_id)
    WHERE status = 'current';
