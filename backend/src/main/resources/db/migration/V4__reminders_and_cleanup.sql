-- Practice reminders actually send now, so remember when the last one went out (at most one per week).
-- "Product updates" had no content source and no sender, so the preference is removed rather than left as a switch that does nothing.
ALTER TABLE user_preferences
    DROP COLUMN notify_product_updates,
    ADD COLUMN last_reminder_at TIMESTAMPTZ;
