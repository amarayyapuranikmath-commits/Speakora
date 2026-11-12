-- Moderation: report resolution + audit trail. AI coach: explicit consent flag and the learner's saved coach entries.

ALTER TABLE user_preferences
    ADD COLUMN ai_coach_consent    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN ai_coach_consent_at TIMESTAMPTZ;

ALTER TABLE user_reports
    ADD COLUMN resolved_at     TIMESTAMPTZ,
    ADD COLUMN resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN resolution_note VARCHAR(500),
    ADD CONSTRAINT chk_report_status CHECK (status IN ('OPEN', 'ACTIONED', 'DISMISSED'));
CREATE INDEX idx_user_reports_status_created ON user_reports (status, created_at DESC);

CREATE TABLE moderation_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    target_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action          VARCHAR(20) NOT NULL CHECK (action IN ('SUSPEND', 'UNSUSPEND', 'ACTION_REPORT', 'DISMISS_REPORT')),
    reason          VARCHAR(500),
    report_id       UUID REFERENCES user_reports(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_moderation_actions_target ON moderation_actions (target_user_id, created_at DESC);

CREATE TABLE coach_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    input_text  VARCHAR(2000) NOT NULL,
    feedback    JSONB NOT NULL,
    model       VARCHAR(80),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_coach_entries_user ON coach_entries (user_id, created_at DESC);
