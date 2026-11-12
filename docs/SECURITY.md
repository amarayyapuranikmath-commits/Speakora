# Security and privacy

## Implemented controls

| Concern | Control |
|---|---|
| Passwords | BCrypt (cost 12); 8–72 chars, letter + digit; constant-time-ish login (dummy hash for unknown emails) |
| Sessions | 15-min HS256 access token held in memory; opaque refresh token in an httpOnly, SameSite=Strict cookie scoped to `/api/auth`; stored only as SHA-256 |
| Refresh rotation | every refresh revokes the old token; reuse of a rotated token (outside a 10 s race window) revokes the whole token family |
| Account recovery | single-use hashed tokens (verify 24 h, reset 1 h) plus six-digit codes for the mobile app (hash bound to the account, 30 min, spent after 5 wrong guesses, only the newest email works, at most 6 codes per 15 minutes per account or address plus a daily cap on code emails, identical answers for unknown and wrong); reset revokes all sessions; forgot-password never reveals whether an email exists |
| WebSocket auth | 30-second WebSocket-only ticket, replayable within that window (never the access token in a URL); Origin allow-list; one socket per user; message-size cap and rate limit |
| Call authorisation | every call action checks the caller is a participant; signalling is relayed only between the two participants of a live call |
| Rate limiting | per-IP limits on the API and stricter limits on credential endpoints (Redis, in-memory fallback if Redis is down) |
| CORS / headers | explicit origin allow-list, `nosniff`, frame deny, no-referrer |
| Input | Bean Validation on all request DTOs; enums for levels/reasons; no entities in responses; generic 500 messages |
| Privacy | no call recording or audio storage; partners see display name (+ country/level only if enabled); email, DOB and ids never exposed; partners identified via call id |
| 18+ | date of birth required and enforced server-side at registration |
| Abuse | block (both directions excluded from matching) and report from the call screen and history; suspended users cannot log in, refresh or match |
| TURN | short-lived credentials (1 hour) are issued by Turnix to the backend on request; the Turnix API token stays on the server (never logged, never returned, never in the web or Android app), redirects are not followed, and clients keep credentials in memory only |
| Account deletion | password-confirmed; PII removed/anonymised, sessions revoked, user removed from the queue |

## Added since: moderation and revocation

- **Suspension and account deletion take effect immediately**: refresh tokens revoked, active call ended, queue entry and signalling socket closed, and the user's existing access tokens are rejected (Redis `revoked:<id>` key, kept 30 min, local fallback if Redis is down).
- **WebSocket tickets are single-use** (Redis SET NX, local fallback).
- `/api/admin/**` requires ROLE_ADMIN; admins are promoted only from `ADMIN_EMAILS` after email verification; admins cannot suspend themselves or each other; every decision is stored in `moderation_actions`.
- **AI Coach**: nothing is sent to the provider without explicit consent (stored with a timestamp and withdrawable). The device holds the live conversation and sends recent text turns to the backend; the backend forwards them to the configured AI provider and does not persist conversation or review text. Audio is not sent to the Coach or stored by the app. Provider errors do not expose upstream response bodies; per-user rate and daily limits apply.

## Known gaps / to do before launch

- No automatic suspension thresholds or moderator notifications (decisions are manual in the admin screen).
- Age is self-declared (date of birth); there is no identity verification.
- No email-based login alerts, 2FA or CAPTCHA on registration.
- CSRF protection relies on SameSite=Strict plus bearer tokens on all state-changing endpoints except `/auth/refresh` and `/auth/logout` (cookie-only; low impact).
- Rate limiting keys on the verified caller address from `ClientIpResolver`. Forwarded headers (`X-Forwarded-For`, `Forwarded`) are ignored unless the TCP peer is listed in `TRUSTED_PROXIES` (the production compose lists the private Docker ranges); `server.forward-headers-strategy` is `none`. **Behind any reverse proxy you must set `TRUSTED_PROXIES`**, otherwise every visitor shares the proxy's address and its limit. (Fixed after an audit found the limiter could be bypassed with a forged `X-Forwarded-For`; regression tests: `RateLimitSpoofingTest`, `RateLimitTrustedProxyTest`.)
- Dev mode logs verification/reset links when SMTP is not configured. Configure SMTP in production.
- Dependency and container scanning, secret rotation procedures and a penetration test have not been done.
- Terms of service and a full privacy policy are not written; `/safety` describes actual behaviour only.


## Friends, messaging, learning and the tutor

- **Only accepted friends can privately call or message.** Enforced in the backend on every operation (`FriendService.canContact`), never only in the interface. Friend handles are opaque and per-viewer.
- **Blocking prevents all contact:** friendship, requests, call invitations and messages stop at once, in both directions; the blocked person is not told they were blocked.
- **Limits:** 20 friend requests per day, a 7-day cooldown after a decline, 30 messages per minute, 2,000 characters per message, 200 friends.
- **Learning results** are recorded only from answers graded on the server. Answer text is never stored.
- **AI Coach conversation privacy and legacy data**: the current implementation keeps the conversation in device memory and sends recent text turns with each request after consent. The application does not save the conversation text, but the configured provider receives the text needed to answer and its retention practices are separate. Voice input is transcribed on the user's device; this app does not send audio to the Coach or store it. On Android, the system speech service may process audio outside the app. The microphone is requested only when the learner starts voice input and is released when leaving the Coach screen; the Coach cannot hear or score pronunciation. The system prompt treats user text as untrusted, and the provider key stays on the backend. Existing records from the former persisted Coach implementation are not read by the new stateless endpoints. **V12 drops the legacy `coach_entries`, `tutor_conversations`, and `tutor_messages` tables; do not apply it until any records that must be retained have been backed up and verified.**
- **Not end-to-end encrypted:** private messages are stored on the server so users can read them later. The app and the safety page say so.
