# Architecture

## Overview

```
Browser (React) ──HTTPS /api──▶ Spring Boot ──▶ PostgreSQL  (users, calls, feedback, stats)
      │  ▲                          │  └────────▶ Redis       (queue, presence, active-call markers, rate limits)
      │  └─── WSS /ws/signaling ────┘
      └──────── WebRTC audio (Opus, DTLS-SRTP) ──────▶ other browser   (via STUN, or TURN relay when needed)
```

Audio never touches the backend. The WebSocket carries only queue control, call control and SDP/ICE relay.

## Backend modules (`com.englishspeaking.platform.*`)

| Module | Responsibility |
|---|---|
| `auth` | register/login, refresh rotation, email verification, password reset, token hashing |
| `user`, `profile`, `preferences` | account entity, CEFR profile, privacy/matching preferences, `/api/me`, account deletion |
| `topics` | conversation topics and prompts |
| `matching` | queue entries, scoring, `MatchmakingStore` (Redis), sweeper |
| `calling` | call entity, state machine, `CallService`, history read model, ICE/TURN credentials, janitor |
| `websocket` | handshake auth (ticket), `SignalingHandler`, session registry, event broadcaster |
| `feedback`, `moderation`, `statistics` | feedback, block/report, streaks and daily activity |
| `notification` | email (SMTP or log fallback) |
| `security`, `common` | JWT, filters, rate limiting, error model, config |

Modules communicate through services and Spring events (`CallEvents.*`) so `websocket` and `matching` do not depend on each other.

## Matchmaking

1. `queue.join` validates the user (active, onboarded, not in a call), writes an entry to a Redis ZSET (+ JSON entry with TTL).
2. `tryMatch` ranks other queued users: excludes self, blocked either way and offline users; scores level proximity
   (hard limit of 2 CEFR levels for the first 30 s, then relaxed), shared interests and same topic. **Someone you talked to in the last
   10 minutes is a last resort, not a ban:** they are skipped for the first 5 s of waiting, ranked below every other compatible user
   afterwards, and matched only if nobody else is available (otherwise two users, for example two testers, could never talk twice).
3. `tryClaim` is one **Lua script**: both users queued and neither in a call → remove both from the queue and set `mm:active:{user}` for both.
   Two matchers racing for the same user: exactly one script succeeds.
4. `CallService.createMatchedCall` persists the call in PostgreSQL; `MatchFound` is delivered to both sockets after commit.
   If persistence fails, markers are released and both users return to the queue.
5. Searching continues until the user cancels, goes offline (presence TTL 35 s, heartbeat every 15 s) or 10 minutes pass (`queue.timeout`).
   The sweeper retries matching every 3 s so relaxed rules apply as waiting grows.
6. Skip = end the call, then rejoin the queue; the previous partner is deprioritised as in step 2.
7. In-call markers are released only **after** the call row is committed as finished, so nobody is re-matched while PostgreSQL still says they are in a call.
8. The server drops a waiting user from the queue when their socket closes, so **clients re-send `queue.join` when the link comes back while
   searching** (web and Android do). A second window/device for the same account closes the first with code 4001; the client does not reconnect
   after 4001/4003 (that would make the two windows evict each other forever).

## Previous partners (call again)

People with a **connected call of at least 15 s** between them are "previous partners" (`GET /api/partners`: display name, level and country
if they chose to share them, number of conversations, last conversation, availability, and an opaque per-viewer `ref`: an HMAC, never a user id).
Availability is `ONLINE` (socket connected and free), `IN_CALL`, `OFFLINE` or `NOT_ACCEPTING` (they turned off *Let previous partners ask me for a call*).
Blocked people (either direction) and suspended/deleted accounts never appear. Block/report use the existing call endpoints with `lastCallId`.

A request is only an invitation. Table `partner_requests` (PENDING / ACCEPTED / DECLINED / CANCELLED / EXPIRED / UNAVAILABLE):

1. `connect.request {partnerRef}` is checked (not in a call, really a previous partner, not blocked, target reachable and free), stored, and the
   target gets `connect.request {requestId, expiresAt, from}` in real time; the requester gets `connect.ringing`. If the target is offline, busy or opted
   out the requester gets `connect.status {status: UNAVAILABLE, reason: OFFLINE|BUSY|NOT_ACCEPTING}` and nothing is stored.
2. The target answers with `connect.accept` or `connect.decline`; the requester can `connect.cancel`. Unanswered requests expire after 45 s.
3. On accept the row is locked, both users are checked again, `MatchmakingStore.claimDirect` (a Lua script: neither user in a call; removes either from the queue)
   marks both as in the call, and `CallService.createMatchedCall` creates the call, so both clients get the normal `match.found` and everything after
   it (signalling, WebRTC, the call state machine) is unchanged. Nobody is ever put in a call without accepting.
4. If both people ask each other, that is mutual consent and they are connected at once. Asking the same person twice does not duplicate; asking someone else withdraws the first.
5. Limits: after a decline the requester must wait 60 s for that person; at most 10 requests per 10 minutes. Blocking, disconnecting or starting a random
   search withdraws open requests. A blocked requester is only told "unavailable".

Because people must be reachable, **the web and Android clients keep the signalling socket open while signed in** (not only during calls). Android
holds it while the app is in the foreground; there are no push notifications, so someone with the app closed shows as `OFFLINE`.

## Call state machine

`MATCH_FOUND → CONNECTING → CONNECTED ⇄ RECONNECTING → COMPLETED`, with `CANCELLED` (ended before media connected) and `FAILED`
(setup failure/timeout) as the other terminal states. `IDLE` and `SEARCHING` are client/Redis states only. Illegal transitions throw `INVALID_CALL_STATE`.
CONNECTED requires **both** peers to report an established connection. A dropped socket sets RECONNECTING; if the user is not back within 20 s the
call ends (`DISCONNECTED`). Calls stuck in setup >90 s are timed out by `CallJanitor`. Every mutation locks the call row (`SELECT … FOR UPDATE`).

## WebSocket protocol (`/ws/signaling?ticket=…`)

Obtain a 30-second single-purpose ticket with `POST /api/ws/ticket` (bearer auth), then connect.

Client → server: `ping`, `queue.join {topicSlug?}`, `queue.cancel`, `signal {callId, kind: offer|answer|candidate, payload}`,
`call.connected {callId}`, `call.reconnecting {callId}`, `call.failed {callId}`, `call.end {callId}`, `call.skip {callId, topicSlug?}`,
`connect.request {partnerRef}`, `connect.cancel {requestId}`, `connect.accept {requestId}`, `connect.decline {requestId}`.

Server → client: `connected`, `pong`, `queue.joined|cancelled|timeout`, `match.found` / `call.resume {callId, initiator, topic, partner{displayName, country?, englishLevel?}}`,
`signal {callId, kind, payload}`, `call.state {callId, status, endReason, durationSeconds, endedBy: you|partner|system}`, `error {code, message}`,
`connect.request {requestId, expiresAt, from}` / `connect.ringing {requestId, expiresAt, partner}` / `connect.status {requestId, status, reason}` / `connect.closed {requestId, reason}`.

The partner with the lower user id creates the offer (deterministic, so roles survive a resume). ICE restart is performed by the offerer.

## Data model

Flyway migrations in `backend/src/main/resources/db/migration` are the schema source of truth. They define the account, call, moderation, friendship,
learning and daily-plan tables. UUID keys, `TIMESTAMPTZ` (UTC), cascade delete from `users` to owned rows, `SET NULL` for topic/report-call references,
unique `(call_id, author_id)` on feedback, `CHECK` constraints on status/rating/self-block. Tokens are stored as SHA-256 hashes only.

V12 drops the legacy `coach_entries`, `tutor_conversations` and `tutor_messages` tables; V13 creates `daily_plans`. Do not apply V12 to a database
whose Coach records must be retained until those records have been separately backed up and the backup verified. The current stateless Coach API does not
read those legacy records.

## REST API (all under `/api`; JSON; errors `{code, message, details?}`)

Auth: `POST /auth/register|login|refresh|logout|verify-email|resend-verification|forgot-password|reset-password`.
Account: `GET /me`, `POST /account/password`, `DELETE /account`. Profile: `GET|PUT /profile`, `POST /profile/onboarding`. `GET|PUT /preferences`. `GET /topics`.
Calls: `GET /calls?page&size`, `GET /calls/{id}`, `GET /calls/ice-servers`, `POST /calls/{id}/feedback|block-partner|report`, `POST /ws/ticket`.
Moderation: `GET /blocks`, `DELETE /blocks/{userId}`. Stats: `GET /stats/summary`, `GET /stats/activity?days`.
Interactive docs: `/swagger-ui.html` (springdoc).

## Frontend

Feature folders under `src/features/*`; shared UI in `src/components/ui`; design tokens in `src/index.css` (`@theme`).
Access token is held in memory only; the refresh token is an httpOnly, SameSite=Strict cookie scoped to `/api/auth`.
`CallProvider` (in `AppLayout`) owns the signalling socket, peer connection and microphone so a call survives navigation.

## Known design limitations

- Streaks and "today" use UTC days, not the user's time zone.
- Matching is a single global queue (no regional sharding); the Redis claim is multi-instance safe, the in-process WebSocket registry is not
  (a horizontally scaled deployment needs sticky sessions or a Redis pub/sub fan-out).
- Reports are stored but there is no moderator UI or automatic suspension yet; suspension is enforced (login, refresh, matching) once `users.status` is set.


## Friends, private calls and messages (migration V6)

- Tables: `friend_requests` (one pending request per pair, enforced by a partial unique index), `friendships` (one row per pair, `user_a < user_b` in PostgreSQL's byte order), `direct_messages`, `conversation_state` (per-person "delete for me" and read marker) and `call_sessions.kind` (`RANDOM` or `PRIVATE`).
- Users are never identified by id on the wire. `PartnerRefs` gives opaque per-viewer handles: one domain for previous partners, another for friends, so one kind can never be used as the other.
- `FriendService` is the single gate. `canContact(a, b)` is true only for accepted friends where neither blocked the other; private call invitations (`ConnectionRequestService`, still the `connect.*` WebSocket messages, now carrying `friendRef`) and every message operation re-check it on the server.
- Blocking publishes `UserBlockedEvent`: friendship and open requests end at once, open call invitations are withdrawn (`FriendshipEndedEvent`), the person disappears from Previous partners and is excluded from random matching.
- Messages are kept until deleted (delete-for-me hides history for one person only; removing a friend deletes the conversation for both). After a block the rows stay unreadable until a 30-day purge so a report can still be reviewed. Message text is never logged. Real-time pushes (`friends.changed`, `message.new`) are sent only after the transaction commits.

## Learn (migrations V7, V8 and V13)

- Content lives in `backend/src/main/resources/curriculum/*.json` and is loaded and validated at start-up by `Curriculum` (the application refuses to start if a lesson lacks a required part). The database stores results in `lesson_progress`, `assessment_results` (scores only), `item_progress` (saved flag, review box, due date), `topic_stats` and `learning_days`; V13 adds `daily_plans`.
- Assessment questions are sent without answers and graded on the server; practice exercises are checked one at a time by the server and record nothing. A lesson completes only on a passed assessment (70%).
- Vocabulary and phrasal-verb review uses five boxes (1, 3, 7, 14 and 30 days). An item counts as learned after three correct reviews.
- Endpoints are under `/api/learn`. Web: `features/learn`; Android: `features/learn`.

## AI Coach

- **Stateless conversations:** the website and Android app keep the live conversation in device memory and send recent text turns with each request. `POST /api/coach/stream` returns streamed events; `POST /api/coach/chat` is the non-streaming response. The application does not persist conversation or review text. Existing records from the former persisted Coach implementation are not read by these endpoints; the configured provider receives the text needed to answer.
- **Legacy data:** migration V12 drops `coach_entries`, `tutor_conversations` and `tutor_messages`. Back up and verify any records that must be retained before applying it.
- **Android voice:** `mobile/android/.../SpeechModule.kt` wraps `SpeechRecognizer` and `TextToSpeech`; the JavaScript speech utilities run the hands-free listen/speak/interrupt loop. Only recognised text reaches the app; audio is handled by the phone's own speech services.
- **Web voice:** uses the browser's speech recognition and synthesis; the server does not receive audio.

## Email codes (migration V10)

`email_verification_tokens` and `password_reset_tokens` have `code_hash` and `failed_attempts`. Each emailed token now has a six-digit code next to
the link (`TokenGenerator.newCode`); only `SHA-256("code:" + userId + ":" + code)` is stored, so equal codes of different people never match.
`POST /api/auth/verify-email-code` (signed in) and `POST /api/auth/reset-password-code` (email, code, new password) read the newest token of the
account: five wrong guesses spend it (the failed attempt is committed even though the call throws), it expires after 30 minutes and works once.
A new email can be requested at any time and is sent at once, while the person waits (a failure is `503 EMAIL_SEND_FAILED` with a plain message); the
newest email is the only one that works. Limits: 6 codes per 15 minutes per account (or per address for forgot-password, counted whether or not an account
exists), a daily cap on code emails (`429 TOO_MANY_CODES` / `EMAIL_DAILY_LIMIT`, both with `Retry-After`). Unknown address, wrong code, expired code and spent code all answer `INVALID_CODE` with the same message. The Android app uses these
endpoints; the website still uses the links.
