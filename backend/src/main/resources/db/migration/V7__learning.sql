-- Learning progress. The curriculum itself (lessons, words, questions) lives in the application resources, not in the database;
-- these tables store only what a learner actually did: results, saved words and review schedules. No answers text is kept.

CREATE TABLE lesson_progress (
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id       VARCHAR(16) NOT NULL,
    attempts        INT         NOT NULL DEFAULT 0,
    best_percent    SMALLINT    NOT NULL DEFAULT 0,
    last_percent    SMALLINT    NOT NULL DEFAULT 0,
    completed_at    TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, lesson_id),
    CONSTRAINT chk_lesson_percent CHECK (best_percent BETWEEN 0 AND 100 AND last_percent BETWEEN 0 AND 100)
);

CREATE TABLE assessment_results (
    id       UUID        PRIMARY KEY,
    user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind     VARCHAR(12) NOT NULL,
    subject  VARCHAR(12) NOT NULL,
    ref      VARCHAR(40) NOT NULL,
    correct  SMALLINT    NOT NULL,
    total    SMALLINT    NOT NULL,
    taken_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT chk_assessment_kind CHECK (kind IN ('LESSON', 'LEVEL', 'REVISION')),
    CONSTRAINT chk_assessment_subject CHECK (subject IN ('GRAMMAR', 'VOCABULARY', 'PHRASAL')),
    CONSTRAINT chk_assessment_counts CHECK (correct >= 0 AND total > 0 AND correct <= total)
);
CREATE INDEX idx_assessment_user ON assessment_results (user_id, taken_at DESC);

CREATE TABLE item_progress (
    user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id          VARCHAR(16) NOT NULL,
    kind             VARCHAR(10) NOT NULL,
    saved            BOOLEAN     NOT NULL DEFAULT FALSE,
    box              SMALLINT    NOT NULL DEFAULT 0,
    correct_count    INT         NOT NULL DEFAULT 0,
    incorrect_count  INT         NOT NULL DEFAULT 0,
    last_reviewed_at TIMESTAMPTZ,
    next_review_at   TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, item_id),
    CONSTRAINT chk_item_kind CHECK (kind IN ('VOCABULARY', 'PHRASAL')),
    CONSTRAINT chk_item_box CHECK (box BETWEEN 0 AND 5)
);
CREATE INDEX idx_item_due ON item_progress (user_id, next_review_at);

CREATE TABLE topic_stats (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id  VARCHAR(16) NOT NULL,
    correct    INT         NOT NULL DEFAULT 0,
    incorrect  INT         NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE learning_days (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     DATE NOT NULL,
    actions INT  NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, day)
);
