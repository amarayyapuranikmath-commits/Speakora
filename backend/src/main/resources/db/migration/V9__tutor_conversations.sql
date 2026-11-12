-- AI tutor conversations. Only what is needed to continue a conversation: a short rolling summary of older turns and the most
-- recent typed turns. Turns that came from voice input are marked and purged automatically after a few hours. Nothing here is
-- used for analytics, and a learner can delete any conversation.

CREATE TABLE tutor_conversations (
    id         UUID         PRIMARY KEY,
    user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode       VARCHAR(24)  NOT NULL,
    title      VARCHAR(80)  NOT NULL,
    summary    VARCHAR(2000),
    topic_id   VARCHAR(16),
    scenario   VARCHAR(200),
    created_at TIMESTAMPTZ  NOT NULL,
    updated_at TIMESTAMPTZ  NOT NULL
);
CREATE INDEX idx_tutor_conversations_user ON tutor_conversations (user_id, updated_at DESC);

CREATE TABLE tutor_messages (
    id              UUID         PRIMARY KEY,
    conversation_id UUID         NOT NULL REFERENCES tutor_conversations(id) ON DELETE CASCADE,
    seq             BIGINT       NOT NULL,
    role            VARCHAR(10)  NOT NULL CHECK (role IN ('user', 'assistant')),
    content         VARCHAR(6000) NOT NULL,
    spoken          BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL,
    UNIQUE (conversation_id, seq)
);
CREATE INDEX idx_tutor_messages_spoken ON tutor_messages (created_at) WHERE spoken;

-- Preferences are kept apart from conversations: they survive deleting a conversation.
CREATE TABLE tutor_preferences (
    user_id              UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    explanation_language VARCHAR(40),
    updated_at           TIMESTAMPTZ NOT NULL
);
