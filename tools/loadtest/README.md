# Load test for Quick Match and signalling

Simulated users only: each one gets a test token, opens a real WebSocket to the backend, joins Quick Match, and exchanges offer, answer and ICE candidate messages with its partner.
**No media is sent** (no WebRTC audio, no TURN), so this measures the backend, not the voice path. Results and what they mean: `docs/SCALABILITY.md`.

The test backend is isolated from the real application: its own port (8096), PostgreSQL schema (`loadtest`, inside the integration-test database), Redis database (6) and a random
JWT secret, with email, the TURN provider and the AI provider switched off. Nothing external is contacted.

```
powershell -File tools\loadtest\start-backend.ps1 -HeapMb 384                      # first start creates the schema (Flyway)
psql -U esp_app -h localhost -d english_speaking_test -v ON_ERROR_STOP=1 -f tools/loadtest/seed.sql
psql ... -tA -c "set search_path=loadtest; copy (select id, english_level from users u join user_profiles p on p.user_id=u.id order by u.email) to stdout with csv" > tools/loadtest/work/lt-users.csv
node tools/loadtest/load.mjs --users 500 --ramp 15000 --hold 4000 --rounds 1 --label t500    # then: python tools/loadtest/summarize.py <run output file>
node tools/loadtest/twoinst.mjs 8      # needs a second instance: start-backend.ps1 -Port 8097 -Secret <contents of work/lt-secret.txt>
node tools/loadtest/logins.mjs 24 6    # registration and login cost
```
`load.mjs` stops itself if the machine's free memory falls below 220 MB (`--minfree`). Run it on a machine with memory to spare: the backend, PostgreSQL, Redis and the generator all share it.

Clean up: `drop schema loadtest cascade;` in the `english_speaking_test` database, and `FLUSHDB` on Redis database 6 (its keys also expire on their own).
