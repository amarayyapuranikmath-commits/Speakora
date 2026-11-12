# Getting code emails into the Inbox, not Spam

Nobody can guarantee Inbox placement: the receiving provider decides, per message and per recipient. This page summarizes the Gmail SMTP checks that were
performed and what is needed for a custom domain. Mailbox and host identifiers are omitted; any example addresses use reserved example domains.

## What was measured (2026-11-11)

From a real code email delivered through the running app (checked with `tools/check-email-headers.py`):

| Check | Result |
|---|---|
| From, envelope sender (`Return-Path`), and the authenticated account | the redacted Gmail account was aligned; nothing spoofed; no `Sender` or `Reply-To` header |
| Sender name | `Speakora` on every message |
| Structure | one `text/plain` part; no HTML, no links, no tracking, no hidden text; `Auto-Submitted: auto-generated` |
| Gmail SMTP | STARTTLS offered and used (TLS 1.3, valid certificate), login accepted, the authenticated account equals the From address |
| Bounces | none (Gmail returned no delivery-failure notices for real recipients) |
| `Message-ID` | It previously used the sending computer's name, which is not a qualified domain. It now uses the configured sender domain, and Gmail keeps it. This was the one header problem that code could fix. |
| First `Received` hop | Gmail records the sending host and its network address. Those identifiers are omitted here and are determined by the mail-sending environment, not the application. |
| SPF, DKIM, DMARC as seen by the recipient | **not measured**: a copy delivered to the sending account itself carries no authentication results. They can only be read from a message that sits in someone else's mailbox |

For a message sent through `smtp.gmail.com` from a Gmail address, Google sends it from its own servers and signs it for `gmail.com`, so SPF, DKIM and DMARC are
expected to pass and be aligned with the From domain. That expectation is **not verified** here: check it on a real received message (below).

## How to check a real message that went to Spam

1. In the recipient's Gmail open the message (in Spam), three-dot menu, **Download message** (a `.eml` file). Or **Show original**, which also shows
   "SPF / DKIM / DMARC: PASS".
2. `python tools/check-email-headers.py path\\to\\message.eml`

It reports the SPF, DKIM and DMARC results and their alignment, the sender identity, the `Message-ID`, the sending machine, and the message structure. It does not
guess a spam score. Gmail's own "Why is this message in spam?" banner (shown at the top of a spam message) is the other source of facts.

## What can be done with the current Gmail sender

Verified in the recorded test: alignment, a consistent sender name, plain text, no links, no hidden content, STARTTLS and a matching authenticated account, and a qualified `Message-ID`.

Possible, and worth doing:

- **Send from a stable place.** The sending host's name and address are recorded in messages. A stable production host makes delivery diagnostics more predictable.
- **Keep volume low and steady, and avoid bursts.** A brand-new Gmail account that suddenly sends many similar automated messages looks like abuse. The app limits
  resends (6 per account per 15 minutes, 400 a day), but repeated test sends from a new account still count against its reputation.
- **Let recipients train Gmail.** The first recipients should open the message, press **Not spam**, and add the sender to their contacts. This helps for that recipient only.
- **Tell users to check Spam** on the code screen (it already says so).

Not possible with a personal Gmail sender, whatever the code does:

- You do not control the reputation of `gmail.com`'s shared signing, and you cannot publish your own SPF, DKIM or DMARC records for it.
- No bounce-handling, complaint (feedback-loop) or reputation dashboards (Google Postmaster Tools only works for domains you own).
- Gmail personal accounts are not meant for transactional mail: about 500 messages a day, and Google may restrict an account that sends automated mail.

## What needs a custom domain (and DNS)

For reliable production delivery, send from an address on **a domain you own** through a transactional email provider. That gives you:

| Piece | What it does | Where |
|---|---|---|
| **SPF** | lists which servers may send for the domain (`v=spf1 include:<provider> ~all`) | a DNS `TXT` record on the domain |
| **DKIM** | a cryptographic signature with the domain's own key | the provider gives a `CNAME` or `TXT` record to publish |
| **DMARC** | tells receivers what to do when SPF and DKIM do not align (`v=DMARC1; p=none; rua=mailto:...`, later `quarantine`) | a DNS `TXT` record on `_dmarc.<domain>` |
| **Reputation of your own domain** | built from your sending, visible in Google Postmaster Tools | postmaster.google.com (domain verification) |
| **Bounce and complaint handling** | the provider reports hard bounces and spam complaints | the provider's dashboard or webhook |

Steps:

1. Buy a domain (about 10 to 15 USD a year). **Needs your approval; nothing has been purchased.**
2. Pick a provider with a free tier that supports SMTP and domain authentication (for example Brevo, Amazon SES, Postmark, Mailgun or Resend). **Needs your approval;
   no provider has been changed.** Brevo does not authenticate free-mail addresses such as `gmail.com`, so a domain is required there too.
3. Add the domain in the provider, publish the SPF, DKIM and DMARC records it shows, and wait until it shows "verified".
4. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM=no-reply@your-domain` (run `tools\\set-smtp.ps1 -Provider Brevo`, or `-SmtpHost`).
   **No code change is needed**: the sender name stays `Speakora` and the `Message-ID` automatically uses the new domain.
5. Verify the domain in Google Postmaster Tools and watch the reputation and spam-rate graphs.
6. Send a test to a Gmail address and run `tools/check-email-headers.py` on it: SPF, DKIM and DMARC should all show **pass** and aligned.
7. Move DMARC from `p=none` to `p=quarantine` once the reports are clean.

Even then, Inbox placement is not guaranteed; it is much more likely, and you can measure and improve it.
