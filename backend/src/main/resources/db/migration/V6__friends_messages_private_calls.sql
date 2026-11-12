-- Friends, private messages and private calls. Additive only: no existing table or row is changed except a new column with a default.

CREATE TABLE friend_requests (
    id            UUID PRIMARY KEY,
    requester_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        VARCHAR(12) NOT NULL,   -- PENDING | ACCEPTED | DECLINED | CANCELLED
    created_at    TIMESTAMPTZ NOT NULL,
    responded_at  TIMESTAMPTZ,
    CONSTRAINT chk_friend_request_status CHECK (status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED')),
    CONSTRAINT chk_friend_request_not_self CHECK (requester_id <> target_id)
);
-- At most one open request between two people, whichever direction it was sent in.
CREATE UNIQUE INDEX uq_friend_request_pending ON friend_requests (LEAST(requester_id, target_id), GREATEST(requester_id, target_id)) WHERE status = 'PENDING';
CREATE INDEX idx_friend_requests_target ON friend_requests (target_id, status);
CREATE INDEX idx_friend_requests_requester ON friend_requests (requester_id, status, created_at DESC);

-- One row per friendship, stored with the smaller user id first.
CREATE TABLE friendships (
    user_a      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_a, user_b),
    CONSTRAINT chk_friendship_order CHECK (user_a < user_b)
);
CREATE INDEX idx_friendships_b ON friendships (user_b);

-- Private text messages between friends. Kept until a participant deletes the conversation. Never used for analytics.
CREATE TABLE direct_messages (
    id          UUID PRIMARY KEY,
    user_a      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        VARCHAR(2000) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    CONSTRAINT chk_dm_order CHECK (user_a < user_b),
    CONSTRAINT chk_dm_sender CHECK (sender_id = user_a OR sender_id = user_b)
);
CREATE INDEX idx_dm_pair ON direct_messages (user_a, user_b, created_at DESC);

-- Per-person view of a conversation: "delete for me" sets cleared_at; last_read_at drives unread counts.
CREATE TABLE conversation_state (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    other_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cleared_at    TIMESTAMPTZ,
    last_read_at  TIMESTAMPTZ,
    PRIMARY KEY (user_id, other_id)
);

-- Random matches stay RANDOM; calls between friends are PRIVATE and never create "previous partners".
ALTER TABLE call_sessions ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'RANDOM';
ALTER TABLE call_sessions ADD CONSTRAINT chk_call_kind CHECK (kind IN ('RANDOM','PRIVATE'));
