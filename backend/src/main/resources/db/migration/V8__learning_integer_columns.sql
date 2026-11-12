-- The application maps these counters as int. Widen the small columns from V7 so the schema matches the entities exactly.
ALTER TABLE lesson_progress ALTER COLUMN best_percent TYPE INT, ALTER COLUMN last_percent TYPE INT;
ALTER TABLE assessment_results ALTER COLUMN correct TYPE INT, ALTER COLUMN total TYPE INT;
ALTER TABLE item_progress ALTER COLUMN box TYPE INT;
