-- The AI Coach no longer stores anything about a conversation. The live conversation is kept in memory on the learner's own device and
-- is cleared when the session ends, so the server tables that held conversations, voice turns and "Review my text" entries are removed.
-- Settings (tutor_preferences: explanation language and voice speed), learning progress, accounts and profiles are not touched.
DROP TABLE IF EXISTS tutor_messages;
DROP TABLE IF EXISTS tutor_conversations;
DROP TABLE IF EXISTS coach_entries;
