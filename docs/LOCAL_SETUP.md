# Local setup (Windows)

## Prerequisites

| Tool | Needed | Status on the dev machine |
|---|---|---|
| JDK 21, Maven 3.9 | backend | installed |
| Node 24 / npm | frontend | installed |
| PostgreSQL 16+ | database | PostgreSQL 18.3 installed, service running |
| Redis-compatible server | matchmaking, rate limits | **not installed**: Memurai Developer install failed (needs an elevated install) |
| Git | version control | installed |
| Docker | optional | not installed |

## 1. Database

Run in **your own terminal** (prompts for the `postgres` superuser password, which is never stored):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-db.ps1
```

The script verifies authentication first, creates role `esp_app` and databases `english_speaking` and
`english_speaking_test`, verifies it can log in as `esp_app`, and only then fills placeholder values in `.env`
(generated DB password and JWT secret). It prints `SUCCESS` only after that verification, and never edits `pg_hba.conf`.

Flyway applies `V1__initial_schema.sql` and `V2__column_types_and_topic_seed.sql` automatically on first backend start.

## 2. Redis

Install Memurai (`winget install --id Memurai.MemuraiDeveloper -e` from an Administrator PowerShell) or run Redis in Docker/WSL.
Confirm with `memurai-cli ping` / `redis-cli ping`.

## 3. Run

```powershell
cd backend;  $env:SWAGGER_ENABLED='true'; mvn spring-boot:run   # reads ..\.env ; API on :8080, Swagger UI at /swagger-ui.html (disabled unless SWAGGER_ENABLED=true)
cd frontend; npm install; npm run dev     # :5173, proxies /api and /ws to :8080
```

Without SMTP configured, verification and reset emails are written to the backend log (including the link) so you can follow them locally.

## 4. Voice testing on one machine

Open two different browser profiles (or one normal and one private window), register two users, finish onboarding in both,
and press *Start looking* in each. Browsers allow the microphone on `http://localhost` without HTTPS; any other host needs HTTPS.
Use headphones to avoid feedback. Two tabs of the same browser profile share one account and will not match each other.

## Environment variables

See `env.example`. Secrets live only in the git-ignored `.env`.
