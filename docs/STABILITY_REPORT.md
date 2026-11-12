# Stability report (2026-11-12)

The companion document `docs/STABILITY_AUDIT.md` lists every finding. This is the summary: what changed, what was run, what is left, and whether the three parts are ready.

## Fixed in this pass (all verified)

| Area | Fix | Evidence |
|---|---|---|
| Website | A dropped connection or server error during the session refresh no longer signs the person out; start-up retries once before showing the login page (`lib/api.ts`, `features/auth/AuthContext.tsx`) | 4 new tests (`apiRefresh.test.ts`) |
| Website | `Quiz.tsx` no longer sets state inside effects (two lint warnings gone) | Learn tests pass |
| Backend | A lone Quick Match searcher is no longer dropped after 3 minutes (entry lifetime 11 min, above the 10-minute search limit) | Live run: before, no match after 200 s alone; after, matched at once. `QueueTimingTest` |
| Backend | Database pool default 20 (`DB_POOL_SIZE` overrides): sign-ups no longer starve Quick Match | Same 36-sign-up test: median match 11.5 s before, 113 ms after |

Earlier in this working session (already reported): the coach backend restart and its API verified, the Android theme Proxy crash and its tests, the Metro tunnel, a Learn test timing flake, the Quick Match turn timing, Android dark mode default.

## Tests run

| Suite | Result |
|---|---|
| Backend `mvn test` (all classes, scratch copy of `backend/src`) | **498 tests, 0 failures** |
| Website `tsc`, `vitest` | clean; **386 of 386** |
| Website `oxlint` / production build | 0 errors, 1 warning (`readableAnswer` export); build succeeds, main bundle 331 kB (102 kB gzip) |
| Android `tsc`, `eslint` | clean |
| Android Jest | **368 of 368** (29 suites) |
| Live checks against an isolated backend (own schema, Redis db, random secret, no external services) | lone-waiter match before/after; sign-up burst with pool 10 vs 20 |

**Not run in this pass:** the Android debug build (no native file changed since the last successful build), Playwright end-to-end (needs the live stack and real accounts), a repeat of the two-browser WebRTC call (it calls the TURN provider; the other agent measured it, see `docs/PERFORMANCE.md`; no call code was changed here), and anything on a physical phone.

## What remains

1. **Restart the dev backend** so it runs the pool and queue fixes (it was restarted earlier on the coach build, before these two changes). Stop the `mvn -o spring-boot:run` process and start it again from `backend/`; no migration is involved.
2. **Run one backend instance only.** Quick Match does not work across instances (verified). Fixing it means Redis pub/sub for match and signalling delivery.
3. **Sign-up e-mail inside the transaction** (H5): recommended to send after commit, with tests, but it changes OTP behaviour, so it was not done unasked.
4. E-mail provider (400 a day), TURN credential caching and limits, Tomcat connection limits, per-IP limit for shared addresses, matching sweep cost (M1 to M5).
5. **Device testing**: dark mode, the coach voice flow, calls and Android navigation have not been seen on a phone. Only Jest, type-checks and a successful debug build back them.
6. 5,000 and 10,000 simulated users were not run (the development machine had too little memory).

## Is it ready to deploy?

| Part | Verdict |
|---|---|
| **Website** | Builds, type-checks and passes 386 tests; the session-loss defect is fixed. **Ready for a small pilot**, subject to a browser pass on the deployed address. Not load-tested beyond what `docs/PERFORMANCE.md` records |
| **Backend** | Passes 498 tests and matched correctly in every load run. **Ready for a small pilot on one instance** after the restart in item 1 and with a real mail provider; **not ready** for more than one instance or thousands of simultaneous Quick Match taps |
| **Android** | Compiles, bundles and passes 368 tests, but **nothing in this pass was verified on a physical phone**, and no signed release build was made here. **Not ready to call production-ready** until it has been tested on a device (login, Quick Match call, coach voice, dark mode) and built with the release keystore |

Nothing was deployed or pushed, and nothing was committed.
