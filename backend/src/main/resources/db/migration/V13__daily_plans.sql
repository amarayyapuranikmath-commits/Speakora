-- The daily lesson: a fixed sequence of grammar lessons, new words and new phrasal verbs, one plan per learner per day (or per "learn more").
-- Only ids and what was done are stored. Results themselves are in assessment_results / lesson_progress / item_progress (V7).

CREATE TABLE daily_plans (
    id            UUID         PRIMARY KEY,
    user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_date     DATE         NOT NULL,
    seq           INT          NOT NULL,
    grammar_id    VARCHAR(16),
    word_ids      VARCHAR(400) NOT NULL DEFAULT '',
    phrasal_ids   VARCHAR(400) NOT NULL DEFAULT '',
    speaking_idx  INT          NOT NULL DEFAULT 0,
    words_done    BOOLEAN      NOT NULL DEFAULT FALSE,
    phrasal_done  BOOLEAN      NOT NULL DEFAULT FALSE,
    revision_done BOOLEAN      NOT NULL DEFAULT FALSE,
    speaking_done BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ  NOT NULL,
    completed_at  TIMESTAMPTZ,
    UNIQUE (user_id, seq)
);
CREATE INDEX idx_daily_plans_user ON daily_plans (user_id, seq DESC);

-- A finished daily practice is a result of its own kind.
ALTER TABLE assessment_results DROP CONSTRAINT chk_assessment_kind;
ALTER TABLE assessment_results ADD CONSTRAINT chk_assessment_kind CHECK (kind IN ('LESSON', 'LEVEL', 'REVISION', 'DAILY'));
