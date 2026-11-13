# Email: what is needed for real delivery

## Provider order (Resend first, SMTP as fallback)

1. **Resend HTTP API** when `RESEND_API_KEY` is set. It uses HTTPS (port 443), so it works on hosts that block outbound SMTP, such as **Render Free (ports 25, 465 and 587 are blocked)**.
2. **SMTP** (Gmail, Brevo, ...) when `SMTP_HOST` is set and there is no `RESEND_API_KEY`.
3. **Neither:** on a local address the email, including the code, is written to the log; on a deployed server nothing is logged and the person is told email is not set up.

Resend is called with `from` = `APP_NAME <MAIL_FROM>`, `to`, `subject` and the same plain-text message as before (`MAIL_HTML=true` adds the HTML part). Templates, the retry rules
(a person waiting for a code: 2 attempts, background reminders: 3; only network trouble, HTTP 429 and 5xx are retried, a bad key or a refused address is not) and the
"email could not be sent" messages are unchanged. Each message carries one idempotency key across its retries, so a retry cannot deliver a code twice. Logs hold the
masked recipient, HTTP status and Resend's short error name, never the key, a code or a link. The key is read only on the server.

**Resend free tier without a domain:** use `MAIL_FROM=onboarding@resend.dev`. Resend then delivers **only to the email address of your own Resend account**; any other recipient
is refused (HTTP 403, `validation_error`), so real users cannot receive codes until you **verify a domain** at resend.com/domains (add the DKIM/SPF DNS records Resend shows) and set
`MAIL_FROM=no-reply@your-domain`. The app reports that refusal as "recipient refused". Resend's free plan also has daily and monthly sending limits (see resend.com/pricing).

| Setting | Meaning |
|---|---|
| `RESEND_API_KEY` | Resend API key (starts with `re_`; create it at resend.com/api-keys with "Sending access"). Server only. Spaces, quotes or line breaks stop the start with a message that does not show the key |
| `MAIL_FROM` | `onboarding@resend.dev` while testing, or an address on your verified domain |
| `RESEND_API_URL` | optional, default `https://api.resend.com` (for tests) |

In production (`SPRING_PROFILES_ACTIVE=prod`) the app refuses to start unless `RESEND_API_KEY` or `SMTP_HOST` is set, and unless `MAIL_FROM` is not empty or an `example.com` address.

The app sends three kinds of email: **email verification**, **password reset** and **practice reminders**. Verification and reset emails carry a
6-digit code (entered in the Android app or on the website) and a link (opened on the website).

**Status:** email delivery is **verified with Gmail SMTP** (2026-11-11). The configured Gmail login (`smtp.gmail.com`, port 587, an app password) was accepted,
a test message arrived in the Gmail inbox (not spam), and the real application flows delivered real emails: a sign-up verification code and a forgot-password
code both arrived in the inbox, and the codes read from those emails verified the account, reset the password and signed in with the new one (7 of 7 checks,
against the running backend, then the test account was deleted). Gmail allows about 500 messages a day from a personal account.

Not verified: how the messages look in other mail clients, and delivery to other mail providers (Outlook, Yahoo, corporate mail), which can treat mail from a
personal Gmail account differently. Brevo (below) is an alternative if Gmail stops being enough, not a requirement.

## What the person sees (website and Android are the same)

- **Sign up** (display name, email, date of birth, password) sends a 6-digit code and opens the **verification screen as the second step of signing up**. It says
  which address the code went to, offers **Send a new code** at any time (sent at once, with a loading state and a clear success or failure message), and lets someone who typed the wrong address sign out and start again. Nothing else opens
  until the code is entered: not the dashboard, not onboarding, and there is no "verify later". The same applies to an account made earlier that was never
  verified: signing in takes it to the code screen first.
- **Sign in** is a normal email and password form with a small **Forgot password?** link. That link is the only way to password recovery: it asks for the
  email, sends a reset code, then asks for the code and a new password. The dashboard and Settings carry no verification, resend or recovery prompts.
- Forgot password **sends nothing for an address that has no account**, and says the same thing either way (so nobody can find out who has an account). If a
  reset code does not arrive, check that the address really is the one the account was made with.

## Who an email is sent to

`MAIL_FROM` decides the From address and nothing else. Every code email is addressed (To) to the address stored for the account: the address typed at sign-up
(trimmed and lower-cased), looked up the same way for Forgot password, and read from the signed-in account for a resend. There is no Bcc, Cc or Reply-To, and
no address is hard-coded. `OtpRecipientIntegrationTest` pins this down over a real SMTP conversation with the sender set to the project's own sending
address: it checks the recipient for several spellings and domains, that nothing is addressed to the sender, that a resend goes to the same address, that an
address with no account gets nothing, and that wrong and expired codes are refused. Putting the bug back (recipient replaced by the sender) makes it fail.

**Testing pitfall.** Some providers deliver plus-address aliases to the same base mailbox. A test sent to an alias of the sender may therefore appear in the
sender's inbox even though it was addressed correctly. To test recipient delivery, use an independently accessible address and inspect the message's To header.

## When "the email did not arrive"

1. The backend log has one line per message handed to the mail server: `Email 'Verify your email for Speakora' accepted by the mail server for masked-recipient@example.net`
   (on a local address the full recipient is shown so you can see exactly where it went; on a deployed server it is masked; the code is never logged). A failure logs `Sending email ... failed (...)` with the reason (for example a refused login), without
   the message. If neither line appears, no email was attempted: for Forgot password that means no account has that address, or a code was sent less than 60
   seconds ago.
2. "Accepted by the mail server" means the provider took it. Look in the **spam** folder of the receiving address, and in the **Sent** folder of the sending Gmail
   account (a wrong address produces a bounce message in its inbox).
3. Restart the backend after any change to `.env`: it reads the settings only at start-up.
4. Automated tests never use these settings (`backend/src/test/resources/application.properties` pins SMTP to unset), so running them cannot send real email.

## Check Gmail yourself

```
powershell -ExecutionPolicy Bypass -File tools\test-smtp.ps1 -To you@your-address
```

`ACCEPTED` means Gmail took the message; only the message arriving proves delivery. Gmail needs 2-Step Verification on the account and a 16-character **app
password** (myaccount.google.com/apppasswords) as `SMTP_PASSWORD`; the ordinary account password is refused. `tools\set-smtp.ps1 -Provider Gmail` stores them.

**Codes landing in Spam?** See `docs/DELIVERABILITY.md`: what was measured, what is possible with a Gmail sender, what needs a custom domain (SPF, DKIM, DMARC), and
`tools/check-email-headers.py` to read the authentication results of a real message.

## Quick start with Brevo (free)

Brevo's free plan sends 300 emails a day over SMTP (`smtp-relay.brevo.com`, port 587, STARTTLS).

1. Create an account at brevo.com and confirm your email address. A new account may need a short activation or review before it can send; Brevo tells you in the dashboard.
2. **Senders:** Brevo > **Senders, Domains & Dedicated IPs** > **Senders** > add the address you want to send from and confirm the email Brevo sends to it.
3. **SMTP login and key:** Brevo > **Settings > SMTP & API**. Use the SMTP login shown there. Create an **SMTP key**
   on the SMTP tab and copy it once. Use the SMTP key, **not** an API key.
4. Run `powershell -ExecutionPolicy Bypass -File tools\set-smtp.ps1 -Provider Brevo`. It asks for the SMTP login, the sender address you verified and
   the SMTP key (typing is hidden), and writes `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` into the git-ignored `.env`. Nothing is
   printed or committed.
5. Restart the backend (stop the process on port 8080, then `cd backend; mvn -o spring-boot:run`).
6. Check the login and send one labelled test message: `powershell -ExecutionPolicy Bypass -File tools\test-smtp.ps1 -To you@your-address`.
   `ACCEPTED` means the provider took it; a refused login or sender is reported in plain words. Then check the inbox and the spam folder.
7. The real proof: **Sign up** or **Forgot password** on the website or in the app with an address you can read, and confirm that the 6-digit code arrives.

**Be aware of one Brevo rule.** Brevo only lets you authenticate a domain you own, and it does not let you authenticate a free-mail address such as
`gmail.com`. For a sender on a free-mail address, Brevo's guidance is that it replaces the From address with one on its own domain (the sender name
`Speakora` is kept), so the message still goes out but the address recipients see is not your Gmail address. This comes from Brevo's help centre as
summarised by search results (the help page itself could not be fetched here), so check what your first message looks like. For a From address on your own
domain with full SPF / DKIM / DMARC, authenticate that domain in Brevo (it needs DNS records). With any provider, `MAIL_FROM` must be an address the
provider has verified.

Other providers work the same way: `tools\set-smtp.ps1 -SmtpHost <host>` with the username and password your provider gives you. Gmail also works if the account can
create an app password (`-Provider Gmail`).

## Settings (`.env` for local use, `.env.prod` and `secrets/` for production)

| Setting | Required | Meaning |
|---|---|---|
| `SMTP_HOST` | yes (this turns real sending on) | The SMTP server of your email provider, for example the host from your provider's "SMTP credentials" page |
| `SMTP_PORT` | no, default `587` | `587` = STARTTLS (required, never falls back to plain text); `465` = implicit TLS |
| `SMTP_USER` | usually | The SMTP username your provider gave you (often not your login email) |
| `SMTP_PASSWORD` | usually | The SMTP password or API key. In production put it in `secrets/SMTP_PASSWORD`, never in `.env.prod` |
| `MAIL_FROM` | yes in production | The sender **address**, for example `no-reply@your-domain`, on a domain you control and have verified with your provider. Production refuses to start with an empty or `example.com` address. The *name* people see is always `APP_NAME` (see below) |
| `APP_NAME` | no, default `Speakora` | The sender's display name and the name used inside every email. Recipients see `Speakora <no-reply@your-domain>` |
| `APP_BASE_URL` | yes in production | The public `https://` address of the site. It is put into every link in the emails; left at the default the links point to `localhost` |
| `SMTP_STARTTLS` | no | Only set `false` for a local test server. Never in production |
| `REQUIRE_VERIFIED_EMAIL` | no, default **on in production**, off otherwise | Keeps unverified accounts out of matching, calls, friends and private messages (see below) |
| `MAIL_HTML` | no, default `false` | `false`: sign-up and reset codes are one plain-text message. `true`: also sends the HTML template as the second part of a flat `multipart/alternative` message |
| `MAIL_DAILY_LIMIT` | no, default `400` | The most sign-up / reset code emails the service sends in a day (the sending account is limited by the provider; Gmail: about 500). `0` = no cap |
| `MAIL_ASYNC` | no, default `true` | Sends practice reminders in the background. Sign-up and reset codes are always sent while the person waits |

Also needed, outside this project: a sending domain with **SPF, DKIM and (recommended) DMARC** records, otherwise most providers' mail lands in spam.
Your provider's documentation says which records to add. Any provider that offers SMTP works (for example Amazon SES, Brevo, Mailgun, Postmark or
your own mail server); no provider has been tested with this project.

## Turn it on and check it

1. Put the settings above in place and restart the backend. The log then says nothing about SMTP; if `MAIL_FROM` is a placeholder it warns.
2. Sign in as an admin, open **Moderation, System**, press **Send test email**. It sends one real message through the configured server and reports
   success or the reason it failed (without showing the password).
3. Register a new account on the website or in the app and check that the verification email arrives (HTML and plain-text), that the sender shows the
   application's name, that the code and the link both work, and that **Resend** sends a new email at once (the older code then stops working).
4. Start **Forgot password**, check the reset email, and reset the password with the code.
5. Look at the messages in Gmail, Outlook and a phone mail app, and check the spam folder.

## What the emails look like

By default (`MAIL_HTML=false`) a code email is **one plain-text message**: the code, how long it works, a "never share this code" line, and, only when the
site has a real public address, the link. While the app runs on a local address the email carries **no link at all**, because a link to `http://localhost`
cannot be opened by anyone reading the email on another device and looks suspicious to spam filters. There is no hidden text. The message is marked
`Auto-Submitted: auto-generated`. The sender name is `APP_NAME`.

With `MAIL_HTML=true` the HTML template below is added as the second part of a flat `multipart/alternative` message (plain text first). One shared layout for all three: the application's name in the brand colour (deep navy `#0B1F4B` for the header, vivid blue `#1D4ED8` for the code, the button and links), one heading, a short
text, the code in large type, how long it lasts, a button for the link, a **"Never share this code"** notice, and a footer that says the message is
automatic and that the service never asks for a password or code by email, phone or chat. It is a single column (max 560 px) with inline styles and
one media query, so it reads on a phone and on a desktop. Every message also has a **plain-text version** for clients that do not show HTML.
There is no image (so nothing to block and no tracking pixel), no marketing, and no claims. The code is never in the subject line. Everything that
comes from outside (a person's name, a link) is HTML-escaped. To look at them: `mvn test -Dtest=EmailTemplatesTest -DemailPreview=<folder>` writes
each message as an `.html` and `.txt` file.

## What the code does (all tested)

- **Codes** are six digits from a secure random generator, stored only as a hash tied to the account and to the purpose (a registration code is
  never accepted for a reset and the other way round), valid for **30 minutes**, usable once, and spent after **5 wrong guesses**. Links stay valid
  for 24 hours (verification) and 1 hour (reset). The text of the email states exactly these times.
- **Resend has no waiting time.** Pressing **Send a new code** sends a fresh code immediately, for sign-up and for a forgotten password. The email is sent
  while the person waits, so the answer is the truth: a success message only after the mail server took the message, and a clear message otherwise.
  **Only the newest email works**: once the new email has been accepted, every earlier code and link is retired (if the new email cannot be sent, the earlier
  code keeps working). The limits that remain, each answered with a clear message:
  - at most **6 codes per account (or, for a forgotten password, per address) in 15 minutes** (`429 TOO_MANY_CODES`, `Retry-After` 900). For a forgotten
    password the limit is counted whether or not the address has an account, so it reveals nothing about who has one;
  - a **daily cap of 400 code emails** for the whole service (`MAIL_DAILY_LIMIT`, `0` = no cap), which keeps the sending account inside what the mail provider
    allows (Gmail: about 500 a day for a personal account) (`429 EMAIL_DAILY_LIMIT`);
  - **10 requests a minute per client address** on the code endpoints.
  A limit never blocks the code the person already has.
- **A failure to send is shown, never hidden.** If the mail server refuses or cannot be reached, the request fails with `503 EMAIL_SEND_FAILED` and a message
  that says what happened and what to do: the email service refused our login (a problem on our side), could not be reached, did not answer in time, refused this
  address (check the spelling), or is not set up on this server. It never shows a credential or a server detail. At sign-up the account is still made and the
  code screen says that the first email could not be sent, with **Send a new code** to try again.
- **Resetting a password** (by code or by link) changes it, **signs the account out on every device** (all refresh tokens are revoked). No password is ever sent by email.
- **Unknown addresses** get the same answer as real ones when a code is requested for a forgotten password (the limit is counted the same way), and a failed
  delivery never stops registration. Because a code is sent while the person waits, a **failure of the mail service itself** (not of one address) is reported
  to whoever asked; this can only show that an account exists while the mail service is down, and nothing else about it.
- **Unverified accounts**: with `REQUIRE_VERIFIED_EMAIL` on (production), an account that has not verified its email can sign in, enter the code,
  learn and use the AI tutor, but the server refuses (`403 EMAIL_NOT_VERIFIED`) everything that reaches other people: friends and friend requests,
  messages, matching and calls. Local development and the automated suites leave it off because they create accounts and use them at once; a
  dedicated integration test runs with it on.
- **Without `SMTP_HOST`** the email is not sent. On a local address (localhost, 127.x, 10.x, 192.168.x) its text, including the code and link, is
  written to the backend log so development works. On any other address the log says only that the email was **not sent** and why: a deployed
  server never writes codes or links into its logs, and no delivery failure ever logs a code or a link.
- **Timeouts and retries**: connecting 10 s, reading and writing 15 s. A network failure, a timeout or a `4xx` "try again later" answer is retried
  (3 attempts, waiting 1 s and 4 s); wrong credentials and a `5xx` refusal are not (retrying cannot fix them) and are logged with the reason, without
  the message. STARTTLS is required on any port except 465, so mail is never sent in clear text by accident.

## What was and was not verified

**Live end-to-end run through real SMTP (20 of 20 checks):** a second copy of the real backend was started against a local SMTP server that records what it
receives, and the flows were driven over HTTP, reading each code **from the email that arrived**, not from a log: sign-up sends a verification email (subject
"Verify your email for Speakora", HTML and plain-text parts, "30 minutes", "Never share this code", no code in the subject); a wrong code is refused, the right
one verifies, and it cannot be used twice; forgot-password answers identically for a known and an unknown address, sends a different reset code, and a repeat
request within a minute sends nothing; a wrong reset code is refused, the right one changes the password, it cannot be reused, the old password stops working
and the new one signs in; the envelope sender is `MAIL_FROM`. The test accounts were deleted afterwards. The sender's display name is checked by the SMTP unit tests.


Verified by automated tests: the templates (HTML and text, escaping, responsive layout, expiry and security wording) and a look at the rendered HTML
in a browser at 390 px and 900 px with no horizontal scroll; the sender's display name; STARTTLS-required and implicit-TLS behaviour;
authentication success and failure; a server that is down; which failures are retried and which are not; that logs never contain a code or link;
Unicode names; the code and link flows against the real backend and database (including expiry, limits, resend, attempt limits and one-time use);
the unverified-account guard; and the website's code forms. All of this used a real SMTP conversation with an in-process
server (GreenMail); the real Gmail run is described under "Status" above.

**Not verified:** delivery to providers other than Gmail, spam placement for other receivers, and how the messages look in Outlook, Apple Mail and other
clients. Sending from a personal Gmail account has no domain authentication of its own; for a From address on your own domain, set up SPF / DKIM / DMARC with the provider.
