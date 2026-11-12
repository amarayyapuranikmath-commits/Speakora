-- Synthetic users for the load test, in the isolated "loadtest" schema only (run after the load-test backend has started once, so Flyway has created the tables).
--   psql -U esp_app -h localhost -d english_speaking_test -v ON_ERROR_STOP=1 -f tools/loadtest/seed.sql
-- then export the ids: psql ... -tA -c "set search_path=loadtest; copy (select id, english_level from users u join user_profiles p on p.user_id=u.id order by u.email) to stdout with csv" > tools/loadtest/work/lt-users.csv
set search_path = loadtest;
insert into users (id, email, password_hash, email_verified, date_of_birth, onboarding_completed)
  select md5('lt-user-' || i)::uuid, 'lt' || i || '@loadtest.invalid', 'not-a-real-hash', true, date '1995-01-01', true from generate_series(1, 10000) i;
insert into user_profiles (user_id, display_name, country, time_zone, native_language, english_level, interests)
  select md5('lt-user-' || i)::uuid, 'Load ' || i, 'IN', 'Asia/Kolkata', 'hi',
         (array['A1','A2','B1','B2','C1','C2'])[1 + (i % 6)],
         (array['{travel}','{music}','{movies}','{sports}','{travel,music}','{movies,sports}'])[1 + (i % 6)]::text[]
  from generate_series(1, 10000) i;
insert into user_preferences (user_id) select md5('lt-user-' || i)::uuid from generate_series(1, 10000) i;
