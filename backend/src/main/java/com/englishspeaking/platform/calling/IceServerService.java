package com.englishspeaking.platform.calling;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.security.AppProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Issues the ICE server list for a client by asking Turnix (https://turnix.io/docs/api-reference/credentials) for short-lived
 * STUN/TURN credentials. The API token is read from configuration only, is sent only as the Authorization header of this one
 * server-side request, and is never logged or returned. Credentials are not cached or stored: each call asks Turnix again.
 *
 * <p>Failure is never papered over with a STUN-only answer: a missing token, a rejected token, an exhausted plan, a timeout or a
 * malformed reply all surface as a clear {@link ApiException}, so a deployment that needs relaying ({@code TURN_FORCE_RELAY=true})
 * can never silently run without it.
 */
@Service
public class IceServerService {
    public record IceServer(List<String> urls, String username, String credential) {}

    /**
     * {@code forceRelay}: clients must use TURN only. {@code expiresAt}: when the credentials stop being accepted for new relays;
     * clients refresh before an ICE restart when it is within 60 seconds.
     */
    public record IceConfig(List<IceServer> iceServers, boolean turnConfigured, long ttlSeconds, boolean forceRelay, Instant expiresAt) {}

    private static final Logger log = LoggerFactory.getLogger(IceServerService.class);
    static final Duration TTL = Duration.ofHours(1);
    static final Duration TIMEOUT = Duration.ofSeconds(10);

    private final AppProperties.Turn turn;
    private final ObjectMapper mapper;
    private final Clock clock;
    private final HttpClient http;

    public IceServerService(AppProperties props, ObjectMapper mapper, Clock clock) {
        this.turn = props.turn();
        this.mapper = mapper;
        this.clock = clock;
        // Redirects are never followed: the bearer token must only ever go to the configured address.
        this.http = HttpClient.newBuilder().connectTimeout(TIMEOUT).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    /** @param clientIp the end user's public IP as resolved by {@link com.englishspeaking.platform.security.ClientIpResolver}, or null. */
    public IceConfig forClient(String clientIp) {
        if (!turn.configured()) {
            log.warn("TURNIX_API_TOKEN is not set: cannot issue TURN credentials");
            throw unavailable(HttpStatus.SERVICE_UNAVAILABLE, "TURN_NOT_CONFIGURED", "Voice calls are unavailable: the server has no TURN configuration.");
        }
        HttpResponse<String> response = post(clientIp);
        int status = response.statusCode();
        if (status == 401) {
            log.error("Turnix rejected the API token (HTTP 401): TURNIX_API_TOKEN is invalid or the plan is inactive");
            throw unavailable(HttpStatus.BAD_GATEWAY, "TURN_PROVIDER_AUTH", "Voice calls are unavailable: the server's TURN configuration is invalid.");
        }
        if (status == 429) {
            log.error("Turnix usage limit reached (HTTP 429)");
            throw unavailable(HttpStatus.SERVICE_UNAVAILABLE, "TURN_USAGE_LIMIT", "Voice calls are unavailable: the TURN relay usage limit has been reached.");
        }
        if (status / 100 != 2) {
            log.error("Turnix returned HTTP {}", status); // status only: never the body or headers
            throw unavailable(HttpStatus.BAD_GATEWAY, "TURN_PROVIDER_ERROR", "Voice calls are temporarily unavailable. Please try again shortly.");
        }
        return parse(response.body());
    }

    private HttpResponse<String> post(String clientIp) {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(turn.apiUrl()))
                .timeout(TIMEOUT)
                .header("Authorization", "Bearer " + turn.apiToken())
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"ttl\":" + TTL.toSeconds() + "}"));
        // Region is deliberately not set: Turnix picks the nearest one from this IP.
        if (clientIp != null && !clientIp.isBlank()) request.header("X-TURN-CLIENT-IP", clientIp);

        CompletableFuture<HttpResponse<String>> pending = http.sendAsync(request.build(), HttpResponse.BodyHandlers.ofString());
        try {
            return pending.get(TIMEOUT.toMillis(), TimeUnit.MILLISECONDS); // hard cap on the whole exchange, body included
        } catch (TimeoutException e) {
            pending.cancel(true);
            throw timedOut();
        } catch (ExecutionException e) {
            // The client's own request/connect timeout can fire a hair before the hard cap above: same outcome.
            if (e.getCause() instanceof java.net.http.HttpTimeoutException) throw timedOut();
            // The exception class only: a message could echo the request URL.
            log.error("Turnix could not be reached ({})", e.getCause() == null ? "unknown" : e.getCause().getClass().getSimpleName());
            throw unavailable(HttpStatus.BAD_GATEWAY, "TURN_PROVIDER_UNAVAILABLE", "Voice calls are temporarily unavailable. Please try again shortly.");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            pending.cancel(true);
            throw unavailable(HttpStatus.SERVICE_UNAVAILABLE, "TURN_PROVIDER_UNAVAILABLE", "The request was interrupted.");
        } catch (CancellationException e) {
            throw unavailable(HttpStatus.BAD_GATEWAY, "TURN_PROVIDER_UNAVAILABLE", "Voice calls are temporarily unavailable. Please try again shortly.");
        }
    }

    private ApiException timedOut() {
        log.error("Turnix did not answer within {} s", TIMEOUT.toSeconds());
        return unavailable(HttpStatus.GATEWAY_TIMEOUT, "TURN_PROVIDER_TIMEOUT", "Voice calls are temporarily unavailable. Please try again shortly.");
    }

    private IceConfig parse(String body) {
        try {
            JsonNode root = mapper.readTree(body);
            List<IceServer> servers = new ArrayList<>();
            boolean hasTurn = false;
            for (JsonNode node : root.path("iceServers")) {
                List<String> urls = new ArrayList<>();
                JsonNode u = node.path("urls");
                if (u.isTextual()) urls.add(u.asText());
                else u.forEach(x -> { if (x.isTextual()) urls.add(x.asText()); });
                urls.removeIf(url -> !isIceUrl(url));
                if (urls.isEmpty()) continue;
                String username = node.path("username").isTextual() ? node.path("username").asText() : null;
                String credential = node.path("credential").isTextual() ? node.path("credential").asText() : null;
                if (username != null && credential != null) hasTurn = true;
                else { username = null; credential = null; }
                servers.add(new IceServer(urls, username, credential));
            }
            if (!hasTurn) {
                log.error("Turnix reply contained no TURN server");
                throw unavailable(HttpStatus.BAD_GATEWAY, "TURN_PROVIDER_ERROR", "Voice calls are temporarily unavailable. Please try again shortly.");
            }
            return new IceConfig(servers, true, TTL.toSeconds(), turn.forceRelay(), expiry(root.path("expiresAt")));
        } catch (IOException e) {
            log.error("Turnix reply was not valid JSON");
            throw unavailable(HttpStatus.BAD_GATEWAY, "TURN_PROVIDER_ERROR", "Voice calls are temporarily unavailable. Please try again shortly.");
        }
    }

    /** The provider's own expiry when it is a sane ISO-8601 instant, otherwise the requested lifetime from now (conservative). */
    private Instant expiry(JsonNode node) {
        Instant fallback = clock.instant().plus(TTL);
        if (!node.isTextual()) return fallback;
        try {
            Instant at = Instant.parse(node.asText());
            return at.isAfter(clock.instant()) && at.isBefore(fallback.plus(Duration.ofMinutes(5))) ? at : fallback;
        } catch (DateTimeParseException e) {
            return fallback;
        }
    }

    private static boolean isIceUrl(String url) {
        String u = url.toLowerCase(Locale.ROOT);
        return u.startsWith("stun:") || u.startsWith("stuns:") || u.startsWith("turn:") || u.startsWith("turns:");
    }

    private static ApiException unavailable(HttpStatus status, String code, String message) { return new ApiException(status, code, message); }
}
