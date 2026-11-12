-- How fast the tutor's voice speaks, chosen by the learner (Slow / Normal / Fast). Normal is the default and is a comfortable, unhurried pace.
ALTER TABLE tutor_preferences ADD COLUMN speech_speed VARCHAR(8) NOT NULL DEFAULT 'NORMAL';
ALTER TABLE tutor_preferences ADD CONSTRAINT chk_tutor_speech_speed CHECK (speech_speed IN ('SLOW', 'NORMAL', 'FAST'));
