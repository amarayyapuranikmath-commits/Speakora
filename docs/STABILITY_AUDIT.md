# Stability audit (2026-11-12)

Findings from reading the actual code and from running it. Each item says whether it was **Verified** (reproduced or measured), **Fixed**, or only **Read** (seen in the code, not run).
What was not examined is listed at the end; nothing here was tested on a physical phone.

## Critical

| # | Issue | Status |
|---|---|---|
| C1 | **Web coach could not reach the backend** after the coach overhaul: the dev backend on :8080 was an old build, the website (served live by Vite) was new. Not a code defect, a stale process | Verified; backend restarted on the current code, new coach API verified on :8080 and through :5173 |
| C2 | **Android theme crash** (`trap result is configurable but target property is non-configurable`): `themed()` was a Proxy, and React Native's development freeze of style props contradicts a Proxy's descriptors | Verified (old Proxy fails the real RN freeze); fixed (sealed plain object of getters); regression tests in `theme.test.tsx` and `themedFreeze.test.ts` |

## High

| # | Issue | Status |
|---|---|---|
| H1 | **A transient failure while refreshing the session signed the person out** (website): a dropped connection or a 5xx made `refreshSession()` return null, and `api()` treated that as "session lost". Also at start-up: a network blip showed the login page | Verified by test; **fixed** (`lib/api.ts`: only 400/401/403 end the session; `AuthContext.tsx`: one retry at start-up); `apiRefresh.test.ts` (4 tests) |
| H2 | **A person searching alone for more than 3 minutes was silently dropped from the Quick Match queue** (queue entry TTL 3 min, search limit 10 min, nothing refreshed it): never matched, never told | **Verified live** (200 s alone, then a compatible user joined: no match, no message); **fixed** (`RedisMatchmakingStore.ENTRY_TTL` 11 min); re-run: matched at once; `QueueTimingTest` |
| H3 | **Database pool of 10 starved Quick Match when people signed up**: sign-up holds a connection while it hashes the password and sends the code e-mail. 36 sign-ups in parallel took 100 users' median match time from 87 ms to 11.5 s | **Verified**; fixed by a configurable pool, default 20 (`application.yml`, `DB_POOL_SIZE`); same test afterwards: median 113 ms, p95 752 ms, nothing waited for a connection |
| H4 | **Two backend instances cannot run Quick Match**: WebSocket sessions live in a per-JVM map, delivery has no cross-instance path | Verified (8 of 8 split pairs failed); **not fixed** (needs Redis pub/sub; see `docs/SCALABILITY.md`). Run exactly one instance |
| H5 | **Sign-up sends the verification e-mail inside the database transaction**, holding a connection for the whole send | Read + measured effect (H3); **not changed**: the order (send, then retire older codes, a failure discards the new code) is deliberate OTP behaviour. Recommended: send after commit with the failure reported afterwards, with new tests |

## Medium

| # | Issue | Status |
|---|---|---|
| M1 | Tomcat defaults (200 threads, accept queue 100, 8,192 connections) saturate at about 1,000 simultaneous Quick Match taps: 12 refused connections measured; WebSockets count toward the 8,192 | Verified at 1,000; limits not raised (needs sizing with the host) |
| M2 | E-mail: 400 code e-mails a day through one Gmail account caps sign-ups | Read (configuration, `docs/EMAIL.md`); needs a transactional provider |
| M3 | TURN credentials are requested from the provider on every call, not cached; the provider's limits are unknown and untested | Read; a quota decision (see `docs/PERFORMANCE.md`) |
| M4 | Per-IP API limit (300 a minute) is shared by everyone behind one address (mobile carriers, campuses) | Read |
| M5 | Matching: the 3-second sweep runs on every instance with no leader, costs about 55 Redis calls per waiter, and only looks at the 50 oldest waiters | Read |
| M6 | The dev backend on :8080 runs the build from before the pool and queue fixes | Needs a restart by you (see the report) |

## Low

| # | Issue | Status |
|---|---|---|
| L1 | `Quiz.tsx` set state inside effects (extra render; two lint warnings) | Fixed (state adjusted during render) |
| L2 | `readableAnswer` is exported from a component file (one lint warning) | Left; harmless |
| L3 | Android has no network-change event; a lost signalling link recovers on backoff and when the app returns to the foreground | Read; measured by the other agent (`docs/PERFORMANCE.md`) |
| L4 | Android release build is unsigned if `keystore.properties` is missing | Read; intended |
| L5 | The tutor stream's abort listener (Android) is not removed after completion | Read; harmless (the request is finished) |

## What was checked and found sound

- **Website:** every timer, listener and socket has a cleanup (`CallContext`, `peer`, `signaling`, dialogs, menus); the signalling client has one retry timer, backoff, a stop on "replaced" or "suspended", and listeners removed on close; the one large chunk (charts, 370 kB) is loaded lazily; concurrent requests share one session refresh (test added).
- **Android:** every `AppState`, keyboard, accessibility and speech listener is removed on cleanup; manifest has `allowBackup=false`, cleartext set per build type, a microphone foreground service declared; debug call diagnostics are off outside development.
- **Backend:** tokens are stateless with a revocation list in Redis; the pairing is an atomic Redis script (no double matches in any run); matching, signalling and call lifecycle produced no error in any load run; indexes exist on the hot call and user paths; password hashing is BCrypt 12.

## Performance

Measured numbers are in `docs/PERFORMANCE.md` (other agent) and `docs/SCALABILITY.md` (this session): connect time 883 ms median for a real two-browser call, signalling recovery 99 ms, Quick Match clean to 500 users on a small shared machine and correct but slow at 1,000 in 3 seconds. Website production build: main bundle 331 kB (102 kB gzip).

## Security notes

No secret was printed or written to the repository by this work. The test backend used a random JWT secret and blank mail, TURN and AI keys. Findings that are security-relevant and **not** changed: none new. Earlier safeguards (rate limits, ticket replay guard, revoked sessions, production safety check) were left as they are.

## Not examined

Physical-device behaviour (the phone was not touched); real audio quality and packet loss; the TURN provider's real limits; 5,000 and 10,000 users; a full browser console sweep of every page; the admin pages in depth; dependency vulnerability scanning.
