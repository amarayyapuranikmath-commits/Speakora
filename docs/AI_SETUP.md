# Configuring AI Coach (Groq, `openai/gpt-oss-120b`)

AI Coach uses **Groq's OpenAI-compatible API** with the model `openai/gpt-oss-120b`. To receive model responses, configure a **Groq API key**.
Until it is set, the Coach reports itself as unavailable. The live conversation stays in device memory; recent text turns are sent with each request,
and the application does not persist conversation text. The configured provider receives the text needed to answer. The key stays on the backend:
no app, web page, log line or API response contains it.

## 1. Get a key

Create one in the Groq Console (console.groq.com → API Keys). It starts with `gsk_`. Keep it out of chats, screenshots, commits and
shell history. Groq applies its own rate limits per account and model; the app handles them (see "Failure behaviour").

## 2. Store it (local development)

Run this **in your own terminal**. The key is typed at a hidden prompt, so it is not echoed and does not enter your command history:

```powershell
powershell -ExecutionPolicy Bypass -File tools\set-groq-key.ps1
```

It writes `GROQ_API_KEY=...` into `.env`, which git ignores (`git check-ignore .env` confirms it), and prints nothing about the key.
Then restart the backend (`cd backend; mvn spring-boot:run`).

Do not use `set GROQ_API_KEY=...` on a command line (it ends up in history), and never put the key in `env.example`,
`application.yml`, the web or Android code, or a chat message.

### Production

Use a Docker secret instead of an environment variable (see `docs/DEPLOYMENT.md`):

```bash
umask 077
printf '%s' "$KEY_FROM_YOUR_PASSWORD_MANAGER" > secrets/GROQ_API_KEY
```

`SECRETS_DIR` makes the backend read the key from that file, and it never becomes an environment variable.

## 3. Settings (all in `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `GROQ_API_KEY` | empty | The key. Empty = the tutor is reported as not enabled. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Model id. |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Requests go to `{base}/chat/completions`. Leave as is (tests point it at a local stand-in). |
| `COACH_DAILY_LIMIT` | `20` | Base daily Coach limit; the chat allowance is a multiple of it. A per-minute limit also applies. |

The old `COACH_API_KEY`, `COACH_MODEL` and `COACH_BASE_URL` (Anthropic) are no longer read. An Anthropic key must not be reused here.

## 4. Check it works

1. Sign in as an admin, open **System → Test coach**. It makes one real request and reports `ok` or the reason it failed.
2. Run the quality evaluation (it is **resumable and rate-limit aware**, so it never needs to be started from scratch):

   ```powershell
   node tools\tutor-eval\run.mjs                    # runs only what is not finished yet
   node tools\tutor-eval\run.mjs --dry-run          # shows the plan and the pacing, sends nothing
   node tools\tutor-eval\run.mjs --report --transcripts   # prints saved results and the tutor's actual words, sends nothing
   node tools\tutor-eval\run.mjs --only=phrasal,pronunciation
   node tools\tutor-eval\run.mjs --redo=roleplay    # forget one saved result and run just that one again
   node tools\tutor-eval\run.mjs --reset            # forget everything (new throwaway account)
   ```

   It creates one throwaway account (`tutor.<timestamp>@example.com`), turns the coach consent on for that account only, and runs a
   short conversation in every tutor mode with PASS/FAIL checks (simple English, memory including after a mode switch, corrections,
   general questions, no repeated or self-contradicting examples, accurate pronunciation guidance and honesty about not hearing,
   roleplay and interview behaviour, no leaking of instructions). The checks catch obvious failures only: **read the transcripts**.

   - **Pacing.** Groq limits requests per minute *and* tokens per minute, and the token limit is the one a tutor conversation hits
     first. The default gap is computed from `EVAL_RPM` (30), `EVAL_TPM` (8000) and `EVAL_TOKENS_PER_REQUEST` (1800), about one
     request every 13.5 s. Read your real limits in the Groq console (Settings, Limits) and set them, or fix the gap with
     `EVAL_GAP_MS`. A full run is about 25 requests, a few minutes.
   - **Retry-After.** When Groq limits a request the backend answers `429 COACH_BUSY` with a `Retry-After` header; the evaluation
     waits exactly that long (never a guess), slows its pace by half again, and stops after two waits for one message or any wait
     longer than `EVAL_MAX_WAIT_S` (90) instead of hammering a limit that has not reset. A used-up daily allowance stops it at once.
   - **Resume.** Each finished scenario is saved immediately to `tools/tutor-eval/state.json` (git-ignored; it also holds the
     throwaway account's password). After a stop, run the same command later: finished scenarios are skipped and the same account is
     reused. Remove the throwaway account(s) afterwards with `node tools/cleanup-test-accounts.cjs` and delete `state.json`.
   - Its own logic is tested without any provider quota: `node --test tools/tutor-eval/lib.test.mjs tools/tutor-eval/run.test.mjs`.

## How the integration works

`GroqCoachProvider` calls `POST {GROQ_BASE_URL}/chat/completions` with `Authorization: Bearer <key>`. The system prompt goes in the
first message (`role: system`), followed by the summary, the recent turns and the new message, exactly as before. Streamed replies use
`stream: true` and server-sent events (`choices[0].delta.content`, ended by `[DONE]`); pieces are forwarded to the web and Android
clients as they arrive. gpt-oss models may also return reasoning text: it is ignored (never shown or stored), the request uses
`reasoning_effort: low` for fast replies and `max_completion_tokens` leaves room for the reasoning plus the answer. If the model
rejects `reasoning_effort` (HTTP 400) the request is repeated once without it.

## Failure behaviour

| Situation | What the learner sees | What the server does |
|---|---|---|
| Rate limit (HTTP 429, or a rate-limit error inside a stream) | "The tutor is very busy right now. Please try again in a moment." (`COACH_BUSY`, 429) | One retry first, waiting the provider's `Retry-After` (capped at 3 s) |
| No answer in time (60 s for headers, 90 s for a whole streamed reply) | "The tutor took too long to answer." (`COACH_TIMEOUT`, 504) | A stalled stream is cut off; no retry (the learner would wait twice) |
| Key rejected (401/403), model missing or retired (404, `model_*`), provider overloaded (503) | "The AI tutor is not available right now." (`COACH_UNAVAILABLE`, 503) | Logs `Groq rejected the API key... Check GROQ_API_KEY` (never the key) |
| Server error, dropped connection, empty or cut-off reply | "The tutor could not respond right now. Please try again." (`COACH_FAILED`, 502) | One retry for server errors and dropped connections |

The backend never retries a rate limit whose `Retry-After` is longer than 3 s (that would only spend more quota); it reports it at
once with the wait in the `Retry-After` header (and `retryAfterSeconds` in a streamed `error` event).

A failed exchange is never stored, so "Try again" in the apps simply sends the same message again. Provider error bodies can echo the
learner's text, so only the HTTP status and a short error code are ever logged.

## Privacy: the coach keeps nothing

Coach conversations are **not stored** (migration V12 drops the old coach tables). The app keeps the live conversation in memory only and sends
the last 20 turns with each request; the backend answers and forgets. Nothing is restored after a restart, the conversation is cleared when the
session ends, a new session starts or the screen is left, no audio is recorded or uploaded (the phone or browser turns speech into text on the device
or with its own speech service), and message text is never written to the server log. What is sent to the AI provider (Groq) is the text of the
current conversation, so that it can write the reply; Groq processes it under its own terms. Learning progress is separate and is kept.

## Testing without a key

The unit tests (`GroqCoachProviderTest`, 23 tests) run the real HTTP client against a local server that speaks Groq's wire format
(streaming, rate limits and Retry-After, timeouts, rejected key, retired model, errors inside a stream). For a full-stack run use the stand-in:
`node tools/fake-coach/server.js`, then start the backend with `GROQ_API_KEY=fake GROQ_BASE_URL=http://127.0.0.1:4010`. This proves the
mechanics, not the quality of the real model. The real model was evaluated with `tools/tutor-eval` (results and what they changed are in `docs/STATUS.md`).

## Accuracy guards

A language model can state wrong facts confidently, so the tutor is not left to its memory where the course has verified data:

- **Phrasal verbs.** When the learner names one of the course's phrasal verbs (119 at the moment) (in any ordinary form: give up, gives up,
  gave up, giving up), the verified lesson (meaning, separability note, examples and real common mistakes) is added to the prompt with
  the instruction to follow it exactly. A real run without this said that "give up" is inseparable and showed a "mistake" identical to its
  correction; with it the reply was correct. Verbs outside the course are answered from the model, with an instruction to say
  "I am not sure" rather than guess about separability. A "common mistake" must show a wrong sentence and a *different* correct one.
- **Pronunciation.** Written guidance only: syllables, stress, a plain-letter respelling (described as approximate), British and
  American differences (never "the same" unless certain), no IPA symbols unless asked, and always a closing pointer to a dictionary's
  audio (Cambridge, Oxford, Merriam-Webster) because a written guide can be imperfect. The tutor never claims to have heard the learner
  and never gives a score, rating or percentage. The mode description in both apps says the same. In one real run the model got the
  respelling wrong ("THOR-uh"): that is why the dictionary pointer is mandatory. **Treat model pronunciation advice as a helpful
  starting point, not an authority**, and there is still no pronunciation scoring anywhere.
