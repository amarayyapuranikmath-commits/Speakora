# Speakora

A platform where adults learn and practise English: one-to-one voice calls with random partners, friends with private messages and calls,
structured grammar, vocabulary and phrasal-verb lessons, and an AI tutor. Website (React) and Android app (React Native).
The product name is configurable (`VITE_APP_NAME`, `APP_NAME`).

| Layer | Stack |
|---|---|
| Web | React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, React Hook Form + Zod, Recharts |
| API | Java 21, Spring Boot 3.5, Spring Security (JWT + rotating refresh tokens), Spring Data JPA, WebSocket, Flyway |
| Data | PostgreSQL (source of truth), Redis (queue, presence, rate limits) |
| Realtime | WebRTC audio (Opus), WebSocket signalling, STUN/TURN relay with time-limited credentials |

> **Current status and verification details: [docs/STATUS.md](docs/STATUS.md)**, including limitations and items that need a device or credentials.

## What is in the product

- **Talk:** Quick Match voice calls (WebRTC, Turnix TURN), call history, Previous partners (people met in random calls; they stay eligible for random matching).
- **Learn:** Grammar (5 levels, 67 lessons), Vocabulary (5 levels, 1,929 words) and Phrasal verbs (3 levels, 299 verbs with 320 meanings), with practice, server-graded tests, level tests, saved and difficult words, daily words and spaced revision. Counts are from the current curriculum files; see [docs/CURRICULUM.md](docs/CURRICULUM.md).
- **AI Coach:** a multi-turn English tutor with nine teaching modes, streamed replies and hands-free voice conversation (browser speech on the web, the phone's speech services on Android). The current implementation keeps live conversation context on the device and sends recent turns with each request; the application does not persist those conversations. Powered by Groq (`openai/gpt-oss-120b`); needs `GROQ_API_KEY` (`docs/AI_SETUP.md`); it processes text after consent and cannot hear or score pronunciation.
- **Friends:** friend requests, private messages and private calls, only between accepted friends; blocking ends all contact.
- **Progress:** speaking time and streaks, lessons completed, test scores, words learned, weak areas and suggested revision, all from recorded results.

The Android app has not been verified on a real phone here; a real AI model and real-microphone call quality have not been verified. See [docs/STATUS.md](docs/STATUS.md) for current test results and limitations.

## Architecture

- The React website and React Native Android app use the same Spring Boot API.
- PostgreSQL stores application data; Redis supports matchmaking, presence and rate limits. Flyway manages database migrations.
- WebSocket carries call signalling. WebRTC carries call audio using short-lived TURN credentials issued by the backend when configured.
- The backend reads local configuration from the ignored `.env` file. Do not put credentials in the frontend or mobile app.
- The stateless Coach does not load or delete legacy saved conversation/review records. **Migration V12 drops the legacy `coach_entries`, `tutor_conversations`, and `tutor_messages` tables.** Back up and verify any records that must be retained before applying it; do not apply V12 when that data must remain in those tables.

## Quick start (Windows)

See [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) for full setup and troubleshooting. You need JDK 21, Maven, Node.js (22.11 or newer for the Android project), PostgreSQL, and a Redis-compatible service.

1. Create the local database and configure the ignored `.env` file. Run this in PowerShell; it prompts for the PostgreSQL administrator password:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-db.ps1
```

2. Start Redis or Memurai on `localhost:6379`.

3. In a new terminal, start the backend:

```powershell
cd backend
mvn spring-boot:run
```

4. In another new terminal, start the website at `http://localhost:5173`:

```powershell
cd frontend
npm install
npm run dev
```

### Android app (optional)

```powershell
cd mobile; npm install
npm run set-api-url          # writes your computer's LAN address into src/apiUrl.generated.ts (never commit that change)
npx react-native start       # Metro, in one terminal
npm run build:debug          # APK in mobile/android/app/build/outputs/apk/debug; install with adb
```
The phone and computer must be on the same network, and the backend must be reachable from the phone. See [docs/REAL_DEVICE_TEST.md](docs/REAL_DEVICE_TEST.md).

## Documentation

- [Architecture, data model, API and signalling protocol](docs/ARCHITECTURE.md)
- [Local setup](docs/LOCAL_SETUP.md)
- [Security and privacy](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Current status, test results and limitations](docs/STATUS.md)

## Commands

| | |
|---|---|
| Backend tests | `cd backend; mvn test` (the integration tests use the `english_speaking_test` database) |
| Frontend tests | `cd frontend; npm test` (`vitest run`) |
| Android tests | `cd mobile; npm test; npm run typecheck` |
| Frontend build | `cd frontend; npm run build` |
| E2E (needs full stack) | `cd frontend; npx playwright install chromium; npx playwright test` |
