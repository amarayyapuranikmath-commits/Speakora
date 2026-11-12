# TURN (relay) with Turnix

Browsers and the Android app connect directly when they can. When both people are behind strict NATs or a corporate firewall, audio must be relayed by a TURN server. The app gets relay credentials from [Turnix](https://turnix.io) ([API reference](https://turnix.io/docs/api-reference/credentials)); there is no TURN server to run yourself.

## What the app does

1. A client (web or Android) calls `GET /api/calls/ice-servers` (sign-in required) before it creates a peer connection.
2. The backend makes one server-side request, `POST https://turnix.io/api/v1/credentials/ice`, with `Authorization: Bearer $TURNIX_API_TOKEN`, body `{"ttl":3600}` and, when known, `X-TURN-CLIENT-IP` set to the caller's real public IP. **No region is configured**: Turnix picks the nearest one from that IP. 10-second timeout, redirects are never followed, nothing is cached.
3. The response keeps its original shape and adds `expiresAt`: `{ iceServers, turnConfigured, ttlSeconds, forceRelay, expiresAt }`. The Turnix token never appears in it.
4. Clients keep the credentials **in memory only**. Before an ICE restart (and before answering one) they fetch new credentials if the current ones have expired or expire within 60 seconds.
5. `TURN_FORCE_RELAY=true` makes clients use the relay only.

## Configuration (backend only)

| Setting | Meaning |
|---|---|
| `TURNIX_API_TOKEN` | Required. Put it in `.env` (git-ignored) for development, or the secret file `secrets/TURNIX_API_TOKEN` in production. Never in the frontend or the Android app. |
| `TURN_FORCE_RELAY` | `true` = relay only. Default `false`: direct connections are cheaper and lower-latency. |
| `TRUSTED_PROXIES` | Comma-separated IPs/CIDRs of reverse proxies whose `X-Forwarded-For` is believed. Empty (default) = no header is believed and the TCP peer address is used. The production compose sets `172.16.0.0/12,10.0.0.0/8` (Caddy and nginx on the private network). |
| `TURNIX_API_URL` | Defaults to the Turnix endpoint. Only change it to point at a test stand-in; in production it must be `https://`. |

## Real client IP

The IP sent in `X-TURN-CLIENT-IP` is only used for choosing a region, but it is still treated carefully: the TCP peer is read from the underlying connection (not from anything a client can set), `X-Forwarded-For` is read only when that peer is a trusted proxy, and the right-most address that is not itself a trusted proxy is used. Private, loopback, link-local and carrier-grade-NAT addresses are not sent (Turnix then falls back to the server's own IP). On a developer machine, calls therefore resolve to the region nearest your server, not you.

## Errors

The endpoint never silently falls back to STUN-only: a call that needs a relay must not appear to work without one.

| Situation | HTTP | `code` |
|---|---|---|
| `TURNIX_API_TOKEN` not set | 503 | `TURN_NOT_CONFIGURED` |
| Turnix rejected the token (401) | 502 | `TURN_PROVIDER_AUTH` (details only in the server log, never the token) |
| Usage limit reached (429) | 503 | `TURN_USAGE_LIMIT` |
| Turnix 422 / 5xx / malformed or TURN-less reply | 502 | `TURN_PROVIDER_ERROR` |
| Network failure | 502 | `TURN_PROVIDER_UNAVAILABLE` |
| No answer within 10 s | 504 | `TURN_PROVIDER_TIMEOUT` |

In production the `prod` profile refuses to start without `TURNIX_API_TOKEN` or with a non-https `TURNIX_API_URL`.

## Verify it (do this before trusting it)

1. Put the token in `.env` as `TURNIX_API_TOKEN=...` and restart the backend.
2. **Admin page, System tab, "Test TURN".** This makes one real Turnix request, then performs a real authenticated UDP allocation against the returned `turn:` address and releases it. (`turns:` and TCP addresses are not probed.)
3. **A real relayed call.** Set `TURN_FORCE_RELAY=true`, restart the backend, and call between two devices. Audio working proves relaying end to end. Set it back to `false` afterwards.
4. **From a hostile network.** A phone on mobile data and a laptop on a guest Wi-Fi that blocks UDP, relay *not* forced. The `turns:` address on 443 is what gets through the strictest firewalls.

What has been verified so far: the backend integration, error handling, client-IP handling and client refresh logic, with automated tests against a **local stand-in** for Turnix. **No real Turnix request has been made and no call has been relayed through Turnix.**

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Call fails to start, `TURN_NOT_CONFIGURED` | `TURNIX_API_TOKEN` is empty in the backend's environment |
| `TURN_PROVIDER_AUTH` | Token is wrong, was removed, or the Turnix plan is inactive |
| `TURN_USAGE_LIMIT` | The plan's data limit is used up: upgrade or wait for the next period (retrying does not help) |
| Test TURN passes, calls still fail | UDP/TCP egress blocked on the user's network, or relay not allowed by the plan: check from another network |

## Notes

- `infra/coturn/` and the compose `turn` profile are the previous self-hosted option. The app no longer reads `TURN_URLS`, `TURN_SHARED_SECRET` or `STUN_URLS`; they are only left in place for anyone who wants to run their own server again (that would need the HMAC code restored).
- `tools/turn-test` and `frontend/e2e/turn-relay.spec.ts` were built for the old credential scheme and need a Turnix stand-in (`TURNIX_API_URL`) before they can run again.
