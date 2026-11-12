# Can Speakora support 10,000 users? A scalability audit (2026-11-12)

**Short answer: not today, and the limit that matters most is not raw power.** Quick Match works correctly for hundreds of people on one backend instance, and
degrades but stays correct at 1,000 people tapping at nearly the same moment. It **cannot run on more than one backend instance** (verified). A sign-up burst
starved Quick Match in the historical tests at the former 10-connection pool setting; the default is now 20 and the subsequent stability report records a repeat test after that change. Nothing about 5,000 or 10,000 users, real WebRTC media or the TURN provider was or could be tested here.
Nothing was changed in the product for this audit; it is a report and a set of measurements.

Words used below: **Verified** = measured in a test I ran; **Estimated** = reasoned from measurements or from documented defaults, not run; **Untested** = not measured at all.

## What was tested, and how

`tools/loadtest/` (see its README). Simulated users get a test token, open a real WebSocket, join Quick Match, relay an offer, an answer and 12 ICE candidates, "hold" the
call for a few seconds and end it. **No audio and no TURN**: this tests the backend (HTTP, authentication, WebSocket, queue, database, signalling), not the voice path.
The test backend was isolated (own port, own PostgreSQL schema, own Redis database 6, random JWT secret, email, TURN provider and AI provider switched off), and nothing
external was contacted. Users were seeded directly in the database (the real sign-up path is measured separately below).

**The machine limits what could be tested.** Everything ran on the development laptop: Intel i5-1235U (10 cores / 12 threads), 7.7 GB RAM of which only about 0.6 GB was free
(browsers and other apps), and the load generator, the backend, PostgreSQL and Redis all shared it. The test backend's heap was capped at 384 MB (224 MB in the last runs).
The generator stops itself when free memory falls below 220 MB; once the machine read 40 MB available, so testing was stopped there. **5,000 and 10,000 users were therefore not run.**
Results on this machine are pessimistic about CPU (the generator competes with the server) and optimistic about nothing.

## Current architecture (from the code)

| Part | How it works today |
|---|---|
| Backend | One Spring Boot process: Tomcat (200 request threads, accept queue 100 and 8,192 connections by default), blocking JDBC and Redis calls on those threads, HikariCP **current default pool of 20** connections (`DB_POOL_SIZE` overrides it) |
| Authentication | Stateless JWT access tokens; every API request also does one Redis lookup (revoked sessions) and one for the per-IP rate limit (**300 requests per minute per IP**, 10 per minute on login and sign-up). Passwords: BCrypt strength 12 |
| Matchmaking | Redis sorted set `mm:queue` (by time), one JSON entry per waiter, presence keys (35 s), "in call" markers; the pairing itself is an **atomic Lua script** (check both users, remove both from the queue, mark both as in a call), so two matchers cannot claim the same person. A scheduled sweep every 3 s retries up to 200 waiters. A candidate window of the 50 oldest waiters. Level gap of at most 2 for the first 30 s, then relaxed |
| Signalling | Spring WebSocket on Tomcat. **Sessions live in an in-memory map inside the JVM** (`SessionRegistry`); `match.found`, call state and every offer, answer and ICE candidate are delivered only to sockets connected to *this* process. There is no Redis pub/sub or any other bridge between instances |
| Database | PostgreSQL: users, calls, friends, messages, learning. About **30 transactions per call** (3 inserts, 11 updates), measured. Indexes exist on the hot paths (`call_participants.user_id`, `call_sessions.status`, e-mail, primary keys) |
| Voice | Browsers and the app connect directly when they can; otherwise audio is relayed by the TURN provider (Turnix). Credentials are requested from Turnix **per call, not cached**, with a blocking HTTP call and a 10 s timeout; if Turnix fails, calls fail closed (by design) |
| E-mail | Sign-up and reset codes go through one Gmail account, capped at **400 code e-mails per day** (`MAIL_DAILY_LIMIT`) |

## Verified results (one instance, shared laptop)

| Test | Result |
|---|---|
| **100 users** over 10 s | 100 of 100 matched into 50 independent calls; ticket p95 12 ms; join to match median 113 ms, p95 707 ms; DB pool peak 1 of 10; heap 106 MB; **no errors** |
| **500 users** over 15 s | 500 of 500 matched, 250 calls; join to match median 38 ms, p95 164 ms, max 543 ms; offer to answer p95 22 ms; pool peak 1 of 10; heap 164 MB; **no errors** |
| **1,000 users** over 10 s | 1,000 of 1,000 matched, 500 calls; join to match median 73 ms, **p95 665 ms**, max 1.2 s; offer to answer p95 592 ms; **pool 10 of 10 with 50 requests waiting, up to 472 ms to get a connection**; Tomcat 143 of 200 threads; heap 299 of 384 MB; system CPU 92% (generator included); no errors |
| **1,000 users in 3 s** (thundering herd) | 984 of 1,000 connected: **12 connection attempts refused and 4 WebSockets failed**; the 984 all matched correctly (492 calls); ticket median 303 ms, p95 1.1 s; **join to match median 1.5 s, p95 6.5 s, max 9.6 s**; offer to answer median 2.3 s; **pool 10 of 10, 106 waiting; Tomcat 200 of 200**; heap 320 of 384 MB; no wrong matches, no crash, recovered |
| **Correctness under load** | In every run each user received exactly one match per round and every call was shared by exactly two users (users matched = 2 x calls each time); offers and answers reached the partner; **no signalling error of any kind**. (I did not inspect which partner each user was given beyond that: the pairing rules are covered by the backend's own tests.) |
| **Cost of a call** | About **30 database transactions** (3 inserts, 11 updates, 338 rows read) for one matched call's whole life |
| **Level rule** | One waiter in a 400-user run waited 30 s: the "similar level only" rule relaxing after 30 s, as designed |
| **Sign-ups starve Quick Match** | Same 100 users with 36 sign-ups arriving at the same time (12 in parallel): **join to match median 87 ms to 11.5 s; p95 1.2 s to 15.5 s**; DB pool exhausted, up to **6.1 s** to get a connection. Cause: `register` is a single transaction that does a BCrypt-12 hash and **sends the verification e-mail while holding a database connection**. (In the test e-mail is switched off, which made sign-ups take about 6 s each; with real SMTP the held time is a different number, the structure is the same) |
| **Login cost** | BCrypt-12: median 380 ms per login, about 15 logins per second with 6 in parallel on this machine (CPU-bound) |
| **Two instances sharing Redis and the database** | **Does not work.** 8 of 8 split pairs (one user on each instance) were matched in Redis and the database, but only the user on the instance that ran the match received `match.found`; the other user received nothing, and no offer or answer could cross between the two. (From the code, that user is also marked "in a call" in Redis until the call setup times out, 90 s; I did not observe that part.) |

## Bottlenecks, in the order they will hurt

1. **Pool saturation in historical measurements (verified at the former default of 10).** Quick Match, sign-up, friends and learning share the pool; a call costs about 30 short transactions and each Tomcat thread blocks while it waits. At 33 joins per second (500 users over 15 s) the pool peaked at 1 of 10; at about 100 per second (1,000 over 10 s) it was fully used with requests waiting; at about 330 per second (1,000 in 3 s) latency rose from milliseconds to seconds. The configured default is now 20; the post-change test is summarized in `docs/STABILITY_REPORT.md`, and the old figures below should not be read as measurements at the current setting. Sign-up can still hold a connection during email sending.
2. **No multi-instance signalling (verified).** One JVM is the ceiling for WebSockets, and it is a single point of failure: restarting it drops every live signalling connection (expected; not tested). This is the hard architectural limit.
3. **Tomcat limits (partly verified, partly estimated).** 200 request threads saturated at 1,000 simultaneous taps and the accept queue overflowed (12 refused connections, verified). **Estimated:** WebSockets count against `max-connections` (default 8,192), so about 8,000 simultaneous sockets is a ceiling until it is raised, together with the operating system's open-file limit.
4. **E-mail (estimated from the configuration).** 400 code e-mails a day means at most about 400 new accounts a day (fewer with resends). 10,000 users cannot be onboarded through one Gmail account.
5. **Matchmaking work per waiter (estimated from the code).** Each retry costs about 55 Redis round trips and one database query, and every instance runs the same 3-second sweep (no leader). With hundreds waiting that is thousands of Redis operations per second per instance; the 50-oldest candidate window can also hold back newer, compatible waiters when the oldest ones are mutually incompatible. Not measured with a large standing queue (in these tests the queue drained at once).
6. **The TURN provider (untested).** Credentials are requested per call without caching, in a blocking call, so each call start waits on an external service whose rate limit and data quota are unknown and were not touched. When the quota ends (429) or the provider is down, no calls can start.
7. **Per-IP rate limit (estimated).** 300 API requests a minute per IP also applies to people sharing one address (mobile carriers and campuses put many users behind one IP), who would see "too many requests" together.

## What would 10,000 users need?

| Scenario | Verdict |
|---|---|
| **About 100 to 500 users online, spread-out taps** | **Verified** on this laptop with a small heap, no errors |
| **About 1,000 online, taps spread over several seconds** | **Verified** to work with seconds of worst-case latency on this laptop; likely comfortable on a real server (estimated) |
| **1,000 taps within about 3 seconds** | **Verified** to degrade (refused connections, 6 to 10 s waits) but stay correct |
| **10,000 users connected, with calls starting at a steady, ordinary rate** (for example 17 joins per second, which is one call per user per ten minutes) | **Estimated** to be possible on one properly sized instance after the changes in step 1 below, because 17 joins per second is well inside the region that was clean (33 per second used 1 of 10 connections) and saturation began near 100 per second, on a weaker, shared machine. **Not verified** |
| **10,000 users tapping Quick Match at about the same time** | **Not supported** (verified degradation at 1,000), and the single-instance design cannot be spread out |
| **More than one backend instance** | **Not supported** (verified) |
| **Voice media and TURN for 10,000 users** | **Untested.** Estimate: a relayed call carries about 50 kbit/s each way per person; 5,000 simultaneous calls with 20 to 30% relayed is about 100 to 150 Mbit/s through the relay in each direction, and 100% relayed about 500 Mbit/s. The provider plan (data limit, concurrent allocations) must be sized for that and I could not check it |

**Do not describe Speakora as supporting 10,000 concurrent users.** What the evidence supports is: correct matching and signalling for hundreds of users on one instance, and graceful but slow behaviour at a thousand simultaneous taps.

## Recommended changes (none were made)

In the order I would do them:

1. **Stop holding database connections across slow work.** Send the verification e-mail after the sign-up transaction commits (or on a queue), and raise the Hikari pool to a measured value (for example 30) together with PostgreSQL's connection limit. This alone removes the verified sign-up-versus-Quick-Match collision. Re-run `tools/loadtest` before and after.
2. **Make signalling work across instances**: route delivery through Redis pub/sub (or Redis Streams): each instance subscribes for its own sockets and publishes `match.found`, call state and signal messages for users it does not hold. Keep `SessionRegistry` as the local fast path. Then run the two-instance test again (`twoinst.mjs`); it should show 8 of 8. Until then run exactly one instance.
3. **Move e-mail to a transactional provider on your own domain** (SPF/DKIM/DMARC, see `docs/DELIVERABILITY.md`) and raise or remove the 400 per day cap.
4. **Cache TURN credentials** for a short time per instance (they live an hour) and add a circuit breaker, then agree the provider's limits for the expected relay volume. Run a media test through the relay on real networks.
5. **Raise Tomcat limits and the operating system's file limits** for the number of simultaneous WebSockets (`server.tomcat.max-connections`, `accept-count`, `ulimit -n`), and consider virtual threads for the blocking handlers.
6. **Matching at scale**: a leader lock (one sweeper), an index-friendly candidate pool by level band instead of the 50 oldest, and fewer Redis round trips per candidate (one pipeline or a Lua script for the presence check).
7. **Per-IP limits**: key the API limit on the user once signed in, keep the per-IP limit for unauthenticated routes only.
8. **Infrastructure**: PostgreSQL and Redis on their own hosts (or managed), at least two application hosts once step 2 is done, a load balancer that can hold WebSockets open, and a test run of 5,000 and 10,000 users from separate load-generator machines against a staging copy, never the development laptop.

## What this audit did not cover

5,000 and 10,000 simulated users; WebRTC media, packet loss, TURN relaying and the provider's real limits; the Android app under load; long soak tests (hours); mass disconnect and reconnect storms; Redis or PostgreSQL failing during load (there are unit tests for a Redis outage, not a load test); PostgreSQL with millions of call rows; and the website and Learn endpoints under load (see `docs/PERFORMANCE.md` for single-user timings).
