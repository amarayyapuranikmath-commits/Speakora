# Performance (2026-11-11)

A measured performance pass over the website, the Android app and the backend. Every number below was produced by the tools in
`tools/perf/` on this machine (Windows 11, local PostgreSQL and Redis); none is an estimate. The raw results are in `tools/perf/results/`.
Where a number moved by less than the run-to-run noise, it says so.

## How things were measured

| What | Tool | Conditions |
| --- | --- | --- |
| Website load and navigation | `tools/perf/web-load.cjs` (Playwright/Chromium) | the **production build** served like nginx serves it (`serve-dist.cjs`: gzip, immutable asset caching, API proxied); empty cache; 5 runs, median. Profile `local` (no throttling) and `mobile` (1.6 Mbps, 150 ms latency, 4x slower CPU) |
| A/B of two builds | `serve-dist.cjs` with `DIST_DIR`, both served against the same backend and user | "before" is `git archive HEAD`, "after" is HEAD plus only the files of this change, built outside the working tree |
| Bundle size | `dist-size.py`, `bundle-attribution.cjs` | gzip level 6 |
| API latency and payload | `api-latency.cjs` | real HTTP, 3 warm-up + 30 timed requests per endpoint, production jar, a user with 40 friends |
| Queries per request | `sql-count.cjs` + Hibernate statistics (`start-backend.ps1 -Stats`) | JDBC statements logged per request |
| Voice | `voice-connect.cjs` | two real browser sessions, fake microphones, real WebRTC, real backend and TURN provider |

The measurement backend runs in its **own PostgreSQL schema (`perf` inside the integration-test database) and its own Redis database (5)**, so
no real data is touched and the running app's matching queue never sees the test users (`start-backend.ps1`).

## Findings and what was changed

### Backend: the friends list asked the database 245 questions (fixed)
`GET /api/friends` is polled every 30 seconds by every signed-in client (it drives the Friends badge). For each friend it made about six
separate queries (account, profile, preferences, conversation state, unread count, newest message).

| 40 friends | before | after |
| --- | --- | --- |
| JDBC statements per request | **245** | **10** (constant, however many friends) |
| latency p50 / p95 | **96.4 / 127.6 ms** | **29.9 / 36.3 ms** |

`FriendService.overview` now loads people in bulk (`PartnerService.views`, `findAllById`) and gets unread counts and newest-message times for all
friends in one native query (`DirectMessageRepository.activityWithFriends`) whose per-friend cut-offs are exactly the ones the old code
computed (friendship start, "delete for me", last read). Tests: the whole friends/partners suite still passes, plus two new ones: the cut-offs
per friend (clear, read marker, a second friend untouched) and "same number of statements for 2 friends and for 12" (mutation-checked: the old
code makes 77 statements for 12 friends and fails it). The query plan could not be inspected meaningfully on a tiny table (PostgreSQL scans
small tables sequentially); the predicates are the ones the previous per-friend queries used on `idx_dm_pair (user_a, user_b, created_at)`.

Everything else measured at 5-20 ms p50 and 1-7 statements. No other N+1 was found. Not changed, with reasons: HTTP compression (nginx already
gzips JSON in production, `frontend/nginx.conf`). This performance snapshot predates the database-pool change: it was measured with the then-current 10-connection default. The current backend default is 20 (`DB_POOL_SIZE` can override it); these results do not benchmark the current pool setting.

### Website
* **Auth screens are loaded on demand.** zod (76 KB) and react-hook-form (33 KB) were in the main bundle for every visitor but are only needed
  by the sign-in/sign-up/reset forms. Main entry chunk: **456.0 KB to 375.3 KB raw, 139.5 to 117.6 KB gzip**. The forms live in their own chunks.
* **The page in the address bar is fetched immediately** (`routes.ts`, `preloadRoute`, called from `main.tsx`) instead of after sign-in was checked
  and the router had rendered. Before, a deep link to a lazy screen (AI Coach, Progress...) showed a spinner in place of the whole app and React then
  held that fallback for about 300 ms; `lazyScreen` now renders a screen directly once its code has arrived (React.lazy alone still suspends once).
* **The layout keeps its header while a screen loads** (a `Suspense` boundary around the page, outside the keyed element so navigation does not
  re-create it and flash a spinner).
* **Main tabs are fetched ahead, gently.** After the page has finished loading its own data, and while the browser is idle, the four main tabs
  (Learn, AI Coach, Friends, Progress) are fetched one at a time. A first version fetched eight screens in one burst; on the throttled profile a click
  that arrived mid-burst got slower (Learn 696 to 1047 ms), so it was made sequential, delayed and limited to the main tabs. It is skipped when the
  browser asks to save data.

Results, production build, medians of 5 (A/B, same backend and user):

| | before | after |
| --- | --- | --- |
| JS downloaded, landing / dashboard (gzip) | 185 KB | **144 KB** |
| Mobile profile, dashboard: first contentful paint | 2456 ms | **1880 ms** (1864 in a second pass) |
| Mobile profile, landing: first contentful paint | 2944 ms | **2480 ms** |
| Local, AI Coach opened from a link | 910 ms | **297 ms** (260 in a second pass) |
| Local, Progress opened from a link | 922 ms | **309 ms** (265) |
| Local, sign-in page | 230 ms | **168 ms** (144) |
| Mobile profile, AI Coach opened from a link | 3786 ms | **3120 ms** (2937) |
| Mobile profile, "ready" for dashboard and landing | 3532 / 3209 ms | 2723 / 2569 ms in the same pass; 2981 / 2640 in a second pass |
| Mobile profile, sign-in page | 2837 ms | 2790 ms (3075 in a second pass): **no gain** (one more round trip for its chunk offsets the smaller bundle) |
| Clicking a main tab, local, after the first screen has settled | Learn 113, Coach 126, Friends 85 ms | **64, 78, 73 ms** |
| Clicking a main tab, mobile profile | Learn 572, Coach 1265, Friends 443 ms | 544, **836, 298 ms** |
| JS fetched when clicking a tab | 2-11 KB | **0** |

Run-to-run noise on the throttled profile is about +/-250 ms, so only the larger moves (and the byte counts, which are exact) are claims.
"Clicking Home" and "Progress" did not change beyond noise. Layout shift was 0.00-0.06 before and after (no change). Duplicate API requests: none
before or after. Fonts load only the needed subset (one 47 KB file); the large `recharts` chunk (361 KB) is already loaded only on the Progress screen.

### Voice (Quick Match and the AI tutor): measured, and improved only where it was safe
Time to connect, two browsers, median of 6: **883 ms** from the second person pressing "Start looking" to both sides connected (match 79-92 ms,
the ICE-server request 300-420 ms, the rest WebRTC set-up). Unchanged by this work.

* **Signalling recovery after an outage: 2380 ms to 99 ms** (5 s outage). The client retried on a doubling back-off (1, 2, 4, 8 s) and a
  returning network had to wait for the next retry. Both clients now retry at once when the browser reports the network is back or the tab is
  visible again (web), or the app returns to the foreground (Android, which has no network event without another library). Retries can no longer
  stack timers. Tested with fake sockets on both clients and mutation-checked.
* **Call diagnostics are off outside debug builds.** Each call polled the WebRTC stack for statistics every 2 seconds only to write a log line. The
  Android flag `CALL_DEBUG` was hard-coded `true` (with a note to switch it off) and is now `__DEV__`; the web only runs it in dev or with
  `localStorage.callDebug = '1'`. The separate statistics timer that drives the quality indicator is untouched.
* **Tried and reverted: fetching the TURN credentials while searching.** It did not shorten the time to connect (883 ms before and after) because the
  last person to press the button is the one the call waits for, and their fetch only starts at their press. A real gain needs the fetch to start
  earlier (for example when the Talk page opens), which would issue credentials to people who never start a search; that is a TURN-plan decision, so
  it was left alone. `/api/calls/ice-servers` takes 220-250 ms (a live call to the TURN provider each time, by design: nothing cached, fail closed).

Audio was not heard by a person in any of this (fake microphones); media paths were not changed.

### Android
* **Chat list no longer redraws every message on each keystroke** (`ChatScreen`): `renderItem`, the list header and styles were new objects on
  every render, so typing re-rendered all mounted messages. Now a memoized row and stable props, with a test that the list receives identical props
  while typing (mutation-checked).
* Call diagnostics and signalling reconnect: see Voice above.
* Already in place and kept: single ABI (`arm64-v8a`), Hermes, Metro `inlineRequires`.
* APK composition (release, 44.1 MB): native libraries 30.1 MB (WebRTC 12.6, React Native 7.1, Hermes 2.7), JS bundle 3.5 MB, Dex 8.5 MB.
  R8/minification (`enableProguardInReleaseBuilds = false`) could shave a few MB of dex but needs keep rules for WebRTC and the notification
  library and a real-phone check of calls; it was not attempted.
* **Not measured:** cold and warm start time, memory and CPU on the phone. The phone was in use during the whole pass and it was not touched.
  `adb shell am start -W com.englishspeakingmobile/.MainActivity` (repeated, force-stopped between runs) on a release build is the way to do it.

## Remaining bottlenecks and ideas
* `/api/calls/ice-servers` (220-250 ms, on the critical path of every call): needs the quota decision above.
* Main bundle is 376 KB raw; react-dom is 202 KB of it and cannot shrink. Further gains need route-level splitting of the dashboard and call code.
* Android start-up and memory: measure on the phone first.
* AI tutor chat on the phone (`TutorChat`) re-renders each message while text streams; it was being rewritten in the same working tree, so it was left.
* `StatisticsService`, `LearnService` and the other endpoints are fast; revisit with data volume (the test schema is tiny).

## Reproducing
```
cd frontend && npm run build
node tools/perf/serve-dist.cjs 4180 http://localhost:8090            # production-like server
powershell -File tools/perf/start-backend.ps1 -Jar backend/target/platform-0.1.0-SNAPSHOT.jar   # isolated schema + Redis db
PERF_DB=english_speaking_test PGOPTIONS="-c search_path=perf" node tools/perf/prepare-user.cjs http://localhost:8090
node tools/perf/web-load.cjs --base http://localhost:4180 --email <perf user> --password Passw0rdOK1 --runs 5 --profile mobile --settle 3500
node tools/perf/api-latency.cjs --base http://localhost:8090 --email <perf user> --password Passw0rdOK1
node tools/perf/voice-connect.cjs --base http://localhost:4180 --a <user1> --b <user2>
```
Remove the test accounts with `prepare-user.cjs --cleanup` and the schema with `drop schema perf cascade`.
