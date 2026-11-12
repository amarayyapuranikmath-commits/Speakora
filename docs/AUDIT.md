# Pre-integration audit (2026-11-09)

Scope: whole frontend and backend, **without PostgreSQL or Redis**. Nothing here proves real-time behaviour; see "Not verified".

## Frontend page checklist

Verified in Chromium at 375 / 768 / 1280 px with the API mocked in the browser (`frontend/e2e/audit.spec.ts`): no horizontal overflow,
zero axe-core WCAG 2.0/2.1 A+AA violations, no text identical to its background, plus manual review of screenshots.
"Unit-tested" = Vitest + Testing Library.

| Route | Page | Real API calls used | Loading / empty / error states | Unit-tested | Audit (3 viewports) |
|---|---|---|---|---|---|
| `/` | Landing | none | n/a | yes | pass |
| `/safety` | Safety and privacy | none | n/a | – | pass |
| `/login` | Login | `auth/login` | field + server errors | yes | pass |
| `/register` | Register (18+) | `auth/register` | field + server errors, age check | yes | pass |
| `/forgot-password` | Forgot password | `auth/forgot-password` | success + error | – | pass |
| `/reset-password` | Reset password | `auth/reset-password` | missing token, success, error | – | pass |
| `/verify-email` | Verify email | `auth/verify-email` | pending / ok / error | – | pass |
| `/onboarding` | 3-step onboarding | `profile`, `topics`, `profile/onboarding` | step validation, server error | yes | pass |
| `/app` | Dashboard | `stats/summary`, `stats/activity`, `calls`, `auth/resend-verification` | all three | yes | pass |
| `/app/talk` | Find partner → searching → call → ended | WebSocket + `calls/ice-servers`, `calls/{id}/feedback|block-partner|report` | mic errors, timeout, reconnecting, failed | yes (UI states, mocked context) | idle state only |
| `/app/topics` | Topics | `topics` | all three | – | pass |
| `/app/history` | Call history + pagination | `calls` | all three | yes | pass |
| `/app/progress` | Progress + chart | `stats/*` | all three | – | pass |
| `/app/settings` | Profile / Account / Privacy / Notifications / Blocked | `profile`, `preferences`, `account*`, `blocks` | all three | yes | pass (all 5 tabs) |
| `*` | 404 | none | n/a | – | pass |

Every frontend `/api` call maps to an existing backend controller method (verified by comparing all paths and HTTP verbs).
Backend endpoints not used by the UI: `GET /api/me`, `GET /api/calls/{id}`.

### Defects found and fixed in this audit
- Primary CTA buttons on green panels rendered white-on-white (invisible): new `inverse` button variant + automated guard.
- Low-contrast secondary text (`text-subtle`) failed WCAG AA: token darkened.
- Invalid `<dl>` structure (stat hints, landing features): fixed.
- Empty link in the in-call banner; banner now also covers the searching state.
- Dialogs had no focus trap; settings tabs had no arrow-key navigation (WAI-ARIA tabs pattern now implemented).
- Silent failures: resend-verification and unblock errors are now shown.
- No error boundary and one static page title: added `ErrorBoundary` and per-route titles.
- Closing the tab during a call/search gave no warning: `beforeunload` guard added; server-link "reconnecting" notice added to the call screen.

## Backend module checklist

| Module | Controller | Service | Repository/entity | Security/validation | Unit tests |
|---|---|---|---|---|---|
| auth | yes | yes | yes (3 token entities) | BCrypt, rotation, reuse detection, hashed tokens | yes |
| user / account | yes | yes | yes | password-confirmed deletion, ends active call | yes |
| profile | yes | yes | yes | timezone/goal/interest validation | – |
| preferences | yes | in controller | yes | DTO validation | – |
| topics | yes | yes | yes | read-only | – |
| matching | (via WebSocket) | yes | Redis store | atomic Lua claim, stale-marker recovery, block exclusion | yes (in-memory store) |
| calling | yes | yes (state machine, janitor, history, ICE) | yes | participant checks, row locking | yes |
| websocket | n/a | handler, registry, broadcaster | n/a | ticket auth, Origin list, rate limit, size cap | **no** |
| feedback | via calls | yes | yes | duplicate guard (check + unique constraint) | yes |
| moderation | yes | yes | yes | partner resolved via call id | yes |
| statistics | yes | yes | yes | UTC streaks | yes |
| notification | – | MailService (SMTP or log) | – | failures never leak | – |
| security / common | filters, config, error model | – | – | rate limiter w/ fallback, safe errors | yes |

### Defects found and fixed in this audit
- **Redis outage would stall every request** (rate limiter used the 60 s driver default): timeouts set to 2 s.
- Unknown URLs / wrong HTTP methods returned 500 instead of 404/405.
- A stale Redis "in call" marker (crash between claim and DB write) could lock a user out for 4 h: Postgres is now the source of truth and stale markers are cleared on join.
- Deleting an account mid-call stranded the partner: the call is now ended first.
- Data-store failures inside WebSocket handling now return a clear `SERVICE_UNAVAILABLE` message.
- Implausible birth dates (>120 years) rejected; Swagger UI/API docs off by default (`SWAGGER_ENABLED=true` for development).
- nginx now sends a CSP and HSTS; docs no longer call WebSocket tickets "one-shot" (they are 30-second, replayable within that window).

## Update 2026-11-09 (after PostgreSQL + Redis were connected)

Verified live: migrations V1/V2 apply, Hibernate validates, health/liveness/readiness (db + redis) UP, a 63-check HTTP + WebSocket script
(matching, atomic claim, relay, authorisation, reconnect, skip, stats, feedback, block, disconnect timeout, 6 simultaneous joiners) all pass,
and the Playwright two-browser journey passes 3/3 with a fake microphone.

Bugs found by running it: account deletion/call end rolled back when Redis was down (listeners now swallow Redis failures);
**one-way audio**: the answering peer never sent its microphone because `addTransceiver` transceivers are not reused for an incoming offer
(fixed by using `addTrack`; the e2e test now asserts both sides receive unmuted, playing RTP).

Still NOT verified: real microphones/speakers and devices, calls across different networks/NAT, TURN, that mute actually silences outgoing audio,
voice quality, behaviour under packet loss, Redis restart mid-call, multi-instance deployment.

## Remaining implementation gaps (earlier list; items 1–3 are now partly resolved, see above)

1. **No test covers `SignalingHandler`, `SessionRegistry`, `WsEventBroadcaster` or the real Redis store** (needs a running server / Redis or Testcontainers).
2. Flyway migrations and JPA mappings unverified (`text[]` columns, record-based `@EmbeddedId`, enum columns, `@Lock` queries, `ON CONFLICT` upsert). Expect to fix a few things on first start.
3. No `@DataJpaTest`/Testcontainers integration tests yet (Docker is not installed; use the local `english_speaking_test` database instead).
4. Access tokens remain valid up to 15 minutes after suspension/deletion (no per-request status check).
5. WebSocket registry is per-process: horizontal scaling needs sticky sessions or Redis pub/sub.
6. Moderation: no admin UI, report review or automatic suspension. Notification preferences are stored but nothing sends reminder/product emails.
7. Streaks are UTC-based. Single global queue. No TURN server has been run.
8. Not started: React Native app, AI coach, admin tooling, terms of service / full privacy policy text.
9. axe covers only the automatable part of WCAG; no screen-reader or real-device testing was done. The call screens in `connecting/connected/reconnecting/ended` states were checked by unit tests, not by screenshot.

## Exact steps for PostgreSQL and Redis integration

1. **Redis**: from an Administrator PowerShell run `winget install --id Memurai.MemuraiDeveloper -e`; check `memurai-cli ping` returns `PONG`. (Or run any Redis ≥ 6 on `localhost:6379`.)
2. **PostgreSQL**: in your own terminal, verify `& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "select 1"` works (reset the password first if not; see below), then run
   `powershell -ExecutionPolicy Bypass -File scripts\setup-db.ps1`. Expect the final green `SUCCESS` line.
3. **First backend start**: `cd backend; $env:SWAGGER_ENABLED='true'; mvn spring-boot:run`. Watch for (a) Flyway applying V1 and V2, (b) Hibernate `validate` errors, (c) `Started PlatformApplication`.
   Fix any mapping error before continuing. Check `http://localhost:8080/actuator/health` shows `UP` (includes db and redis).
4. **API smoke test** (Swagger UI at `/swagger-ui.html`): register → login → `GET /api/topics` (10 seeded) → onboarding → refresh → logout.
5. **Add integration tests** against `english_speaking_test`: repository tests for the custom queries, a `RedisMatchmakingStore` test (two threads racing `tryClaim`), and a WebSocket test with two clients.
6. **Run the stack**: `cd frontend; npm run dev`, open two different browser profiles, register two users, finish onboarding, press *Start looking* in both.
7. **Run the real end-to-end journey**: `cd frontend; npx playwright test e2e/voice-call.spec.ts` (fake microphone). Then do a manual call with headphones on two real devices; only then can audio be called working.
8. **TURN** only after the above: set `TURNIX_API_TOKEN` (Turnix), test from a restrictive network.

Resetting a forgotten `postgres` password (do it yourself; it temporarily relaxes authentication): back up `pg_hba.conf`, change the `127.0.0.1`/`::1`
`scram-sha-256` lines to `trust`, `Restart-Service postgresql-x64-18`, run `psql -U postgres -h localhost` and `\password postgres`,
**revert the lines to `scram-sha-256`**, restart the service again.
