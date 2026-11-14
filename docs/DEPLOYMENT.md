# Deployment

**Honest status.** The backend, frontend build, database migrations, backups, TLS-independent security checks, SMTP and TURN verification tooling were all tested on the real local stack. The **Docker images, `docker-compose.prod.yml`, the production `nginx.conf`, Caddy and coturn configs have never been run** (this development machine cannot run Docker, and downloading a standalone nginx to test it was blocked). Expect to fix small things on first deploy, and use the verification steps below to catch them.

## Architecture

```
Internet --443--> Caddy (automatic HTTPS) --> web (nginx: static site, /api and /ws proxy) --> backend (Spring Boot)
                                                                                                  |--> PostgreSQL (private)
                                                                                                  |--> Redis, password (private)
Internet --3478/5349 + 49152-49252/udp--> coturn (optional but recommended, separate profile)
backend:8081 (health + Prometheus metrics) is private; prometheus scrapes it over the internal network.
```

## What you need (credentials / paid services)
| Need | Notes |
|---|---|
| A server (Linux, 2 vCPU / 4 GB is a sensible start) with Docker + the compose plugin | any cloud VM |
| A domain with an **A record** to the server, plus ports 80/443 open | Caddy gets and renews the certificate itself |
| SMTP account | verification, password reset and reminder emails. Without it nobody can verify or reset. Exact settings: `docs/EMAIL.md` |
| A public IP for TURN and a DNS name such as `turn.<domain>` | see TURN.md; can be the same server |
| Groq API key (optional, `GROQ_API_KEY`) | enables the AI tutor and coach |

## First deployment
1. `git clone` the project on the server. Copy `env.prod.example` to `.env.prod` and fill it in (domain, SMTP host/user, admin email).
2. Create the secret files (one value per file, no trailing newline needed):
   ```bash
   mkdir -p secrets && chmod 700 secrets
   openssl rand -base64 36 | tr -d '/+=\n' > secrets/DB_PASSWORD
   openssl rand -base64 64 | tr -d '/+=\n' > secrets/JWT_SECRET        # must be 48+ chars: the app refuses to start otherwise
   openssl rand -base64 36 | tr -d '/+=\n' > secrets/REDIS_PASSWORD
   printf '%s' 'YOUR_TURNIX_API_TOKEN' > secrets/TURNIX_API_TOKEN     # required: from your Turnix project
   printf '%s' 'YOUR_SMTP_PASSWORD' > secrets/SMTP_PASSWORD         # SMTP fallback; leave empty when using Resend
   printf '%s' 're_YOUR_RESEND_KEY' > secrets/RESEND_API_KEY        # Resend HTTP email (docs/EMAIL.md); takes precedence over SMTP
   printf '' > secrets/GROQ_API_KEY      # or paste the key
   chmod 600 secrets/*
   ```
3. Check the compose file: `docker compose --env-file .env.prod -f docker-compose.prod.yml config > /dev/null`
4. Start: `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build`
   (add `--profile turn` for coturn, `--profile monitoring` for Prometheus).
5. Flyway creates and migrates the schema on first start. Watch: `docker compose ... logs -f backend`.
6. Register your admin account using the address in `ADMIN_EMAILS`, click the verification email, sign in again: you are an administrator.

The backend runs with `SPRING_PROFILES_ACTIVE=prod`: it **refuses to start** if `COOKIE_SECURE` is false, the base URL or CORS origins are not https/are localhost, the JWT secret is short or a placeholder, or the TURN secret is weak. Swagger and error details are off, logs are JSON with a request id.

## Verify the deployment (do all of these)
1. `node tools/check-deployment.js https://YOUR_DOMAIN` checks: HTTP redirects to HTTPS, valid certificate with days left, modern TLS, HSTS, CSP, frame protection, microphone permission policy, anonymous API access refused, CORS closed to other origins, WebSocket refuses a ticketless handshake, and that Swagger/actuator/.env are not public. Add `CHECK_EMAIL` and `CHECK_PASSWORD` environment variables to also verify the refresh-cookie flags (HttpOnly, Secure, SameSite=Strict, path). Every FAIL must be fixed or understood.
2. Sign in as admin, open **Moderation, System**: it must show no red warnings. Run **Send test email**, **Test TURN** and **Test AI coach**; each makes a real call with your real credentials.
3. Walk through REAL_DEVICE_TEST.md on two real devices.

## Configuration reference
| Variable / secret | Purpose |
|---|---|
| `DOMAIN`, `ACME_EMAIL` | public hostname and certificate contact |
| secret `RESEND_API_KEY` / `MAIL_FROM` | email through the Resend HTTP API (works where SMTP is blocked); optional: without any mail provider the app starts and sign-up and sign-in work, but password-reset and reminder emails are unavailable (the user is told so) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / secret `SMTP_PASSWORD` / `MAIL_FROM` | email. Port 465 = implicit TLS, otherwise STARTTLS is **required** (never silently plain text) |
| `ADMIN_EMAILS` | become ADMIN after verifying the address |
| secret `TURNIX_API_TOKEN` (required), `TURN_FORCE_RELAY`, `TRUSTED_PROXIES` | TURN relay via Turnix, see TURN.md |
| secret `GROQ_API_KEY`, `GROQ_MODEL`, `COACH_DAILY_LIMIT` | AI coach |
| secrets `DB_PASSWORD`, `JWT_SECRET`, `REDIS_PASSWORD` | core secrets. Secrets are read from files in `SECRETS_DIR` (`/run/secrets`), so they are not in the environment or in `docker inspect` |

## Logging and monitoring
- **Logs**: JSON (ECS format), one object per line on stdout; every request has an `X-Request-Id` (also returned to the client, and passed through nginx) shown in each line. Ship them with your platform's log driver (Loki, CloudWatch, `journald`...). Passwords, tokens and API keys are never logged (configuration objects redact secrets).
- **Health**: `/actuator/health/liveness` and `/readiness` on the private port 8081; readiness includes PostgreSQL and Redis. The compose health checks use it.
- **Metrics**: `/actuator/prometheus` on port 8081 (never published). `--profile monitoring` runs Prometheus with `infra/prometheus/alerts.yml`: backend down, 5xx rate, slow responses, exhausted DB pool, JVM memory. Connect Alertmanager or Grafana Cloud for notifications; they need your account.
- **Uptime**: also monitor `https://YOUR_DOMAIN/` externally (UptimeRobot, Better Stack...).

## Backups
- The `backup` service writes a verified, compressed dump to `./backups` every 24 h and deletes dumps older than `BACKUP_KEEP_DAYS` (default 14). **Copy `./backups` off the server** (object storage, another machine): a backup on the same disk is not a backup.
- Manual: `docker compose ... exec backup sh -c 'PGPASSWORD=$(cat /run/secrets/DB_PASSWORD) /usr/local/bin/backup-db.sh /backups'`.
- **Restore** (stops the app to be safe): `docker compose ... stop backend`, then `./scripts/restore-db.sh <dump> english_speaking --i-understand-this-overwrites-data` (run it inside a postgres container with `PGHOST=postgres PGUSER=esp_app PGPASSWORD=...`), then `start backend`.
- On Windows (development) the same cycle exists as `scripts\backup-db.ps1` / `restore-db.ps1`; **a full backup, verify, refuse-without-confirmation, restore and compare cycle was tested** and the restored data matched the source table for table. **Practise a restore on a spare database before you need one.**
- Redis holds only temporary state (queue, presence, rate limits); it needs no backup.

## Updating
`git pull && docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build`. The backend shuts down gracefully (25 s), then Flyway migrates on the next start. Take a backup first when a release contains a new migration (`backend/src/main/resources/db/migration`). Migrations only move forward; to roll back, restore the backup.

## Scaling notes
The signalling WebSocket registry is per backend process. Run **one** backend instance, or put several behind sticky sessions (Caddy `lb_policy cookie`) plus Redis pub/sub fan-out (not built). One instance on a modest VM handles a large number of concurrent calls because audio never passes through it (only signalling does).

## Android app download

The website shows a "Download Android app" button only when `ANDROID_DOWNLOAD_URL` is set (it is baked into the web image at build time, as `VITE_ANDROID_DOWNLOAD_URL`). The value must be a public `https://` address or a same-site path; `http://`, localhost, emulator, private-network and file addresses are ignored, so a broken button can never ship. With no value the page says the app is not available yet.

The APK to distribute is the **signed release build** (`mobile/android/app/build/outputs/apk/release/app-release.apk`), never the debug build. It must have been built with your real server address, because the address is compiled into the app:

```powershell
cd mobile
npm run set-api-url -- https://speak.example.com        # your DOMAIN
cd android; .\gradlew.bat assembleRelease; cd ..\..
.\scripts\publish-android-apk.ps1 -ExpectedApiUrl https://speak.example.com
```

The script refuses to publish an APK that is debug-signed, is a debug build, still contains an emulator/local address, or does not contain your address. It copies the file to `./downloads/speakora.apk` with a `.sha256` checksum. The compose file mounts `./downloads` read-only into the web container, which serves it at `https://DOMAIN/downloads/speakora.apk` (`application/vnd.android.package-archive`, forced download, not cached). Then set in `.env.prod`:

```
ANDROID_DOWNLOAD_URL=https://speak.example.com/downloads/speakora.apk
```

and rebuild the web image: `docker compose -f docker-compose.prod.yml up -d --build web`. Verify with `curl -I https://DOMAIN/downloads/speakora.apk` (expect 200 and the APK content type). Alternatives: host the APK on any HTTPS file host and put its URL in `ANDROID_DOWNLOAD_URL`; use a Google Play link only after the app is actually published there.

Every update of the app must be signed with the same release key (`mobile/android/app/release.jks`), or phones will refuse to install it over the old version.
## Security checklist before launch
- [ ] `tools/check-deployment.js` shows no FAIL
- [ ] Admin System tab shows no warnings; test email/TURN/coach are green
- [ ] Database and Redis ports are not published (`docker compose ps` shows no `0.0.0.0:5432` / `6379`)
- [ ] `secrets/` and `.env.prod` are not in git; the server's `secrets/` is `chmod 700`
- [ ] Backups are copied off the server and a restore has been rehearsed
- [ ] Firewall allows only 22 (restrict by IP), 80, 443 and the TURN ports
- [ ] Your terms of service and privacy policy are published (the site's `/safety` page describes only what the product does)
- [ ] A moderation routine exists: someone reviews open reports daily

## First administrator (no email needed)

Registering never makes anyone an administrator, whatever email they use. To create your own admin account without email:

1. Generate a secret of 32+ random characters (for example `openssl rand -base64 48 | tr -d '/+=
'`) and set it on the server as `ADMIN_BOOTSTRAP_TOKEN`. Deploy.
2. Register and sign in normally with your own account.
3. Send the token once, signed in as that account: `POST /api/setup/claim-admin` with the header `Authorization: Bearer <your access token>` and the body `{"token":"<the secret>"}`. It answers `204`.
4. Sign out and sign in again so your new session carries the ADMIN role.
5. Remove `ADMIN_BOOTSTRAP_TOKEN` from the server settings and redeploy.

It works only while no administrator exists, only for a signed-in active account, and only with the exact token (a shorter token disables it). Attempts are rate limited and wrong ones are logged without the token. `ADMIN_EMAILS` still works as before, but only for an address that has been verified by email.
