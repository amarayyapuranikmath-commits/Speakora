-- "Previous partners": a person asks someone they have already talked to for a new call. The other person must accept.
CREATE TABLE partner_requests (
    id            UUID PRIMARY KEY,
    requester_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        VARCHAR(20) NOT NULL,   -- PENDING | ACCEPTED | DECLINED | CANCELLED | EXPIRED | UNAVAILABLE
    created_at    TIMESTAMPTZ NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    responded_at  TIMESTAMPTZ,
    call_id       UUID REFERENCES call_sessions(id) ON DELETE SET NULL,
    CONSTRAINT chk_partner_request_status CHECK (status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED','UNAVAILABLE')),
    CONSTRAINT chk_partner_request_not_self CHECK (requester_id <> target_id)
);
CREATE INDEX idx_partner_requests_target_pending ON partner_requests (target_id) WHERE status = 'PENDING';
CREATE INDEX idx_partner_requests_requester_pending ON partner_requests (requester_id) WHERE status = 'PENDING';
CREATE INDEX idx_partner_requests_pair ON partner_requests (requester_id, target_id, created_at DESC);

-- Lets someone opt out of being asked for a call (they then show as "not accepting requests" to previous partners).
ALTER TABLE user_preferences ADD COLUMN allow_partner_requests BOOLEAN NOT NULL DEFAULT TRUE;
