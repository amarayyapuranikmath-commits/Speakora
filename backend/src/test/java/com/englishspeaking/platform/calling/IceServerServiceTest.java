package com.englishspeaking.platform.calling;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.englishspeaking.platform.TestSupport;
import com.englishspeaking.platform.common.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/** Runs the real HTTP client against a local stand-in for Turnix. This does NOT prove behaviour against the live Turnix API. */
class IceServerServiceTest {
    private static final String TOKEN = "tx_SECRET_TOKEN_VALUE_123";
    private static final String EXPIRES = "\"expiresAt\":\"2026-11-10T11:00:00.000Z\"";
    private static final String GOOD = "{\"iceServers\":[{\"urls\":[\"stun:stun.turnix.io:3478\"]},"
            + "{\"username\":\"4d6c-uuid\",\"credential\":\"cred-abc\",\"urls\":[\"turn:eu.turnix.io:3478?transport=udp\",\"turns:eu.turnix.io:443?transport=tcp\",\"http://evil.example/x\"]}],"
            + EXPIRES + "}";

    private final TestSupport.MutableClock clock = new TestSupport.MutableClock(Instant.parse("2026-11-10T10:00:00Z"));
    private final AtomicReference<String> auth = new AtomicReference<>();
    private final AtomicReference<String> clientIp = new AtomicReference<>();
    private final AtomicReference<String> contentType = new AtomicReference<>();
    private final AtomicReference<String> body = new AtomicReference<>();
    private final AtomicInteger calls = new AtomicInteger();
    private HttpServer server;
    private volatile int status = 200;
    private volatile String reply = GOOD;
    private volatile long delayMs = 0;
    private ListAppender<ILoggingEvent> logs;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/credentials/ice", ex -> {
            calls.incrementAndGet();
            auth.set(ex.getRequestHeaders().getFirst("Authorization"));
            clientIp.set(ex.getRequestHeaders().getFirst("X-TURN-CLIENT-IP"));
            contentType.set(ex.getRequestHeaders().getFirst("Content-Type"));
            body.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            try { if (delayMs > 0) Thread.sleep(delayMs); } catch (InterruptedException ignored) { /* test shutting down */ }
            byte[] out = reply.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("content-type", "application/json");
            try {
                ex.sendResponseHeaders(status, out.length);
                ex.getResponseBody().write(out);
            } catch (java.io.IOException ignored) { /* the client gave up (timeout test) */ }
            ex.close();
        });
        server.start();
        logs = new ListAppender<>();
        logs.start();
        Logger logger = (Logger) LoggerFactory.getLogger(IceServerService.class);
        logger.addAppender(logs);
        logger.setLevel(Level.ALL);
    }

    @AfterEach
    void stop() {
        server.stop(0);
        ((Logger) LoggerFactory.getLogger(IceServerService.class)).detachAppender(logs);
    }

    private String url() { return "http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1/credentials/ice"; }

    private IceServerService service(String token, boolean forceRelay) {
        return new IceServerService(TestSupport.propsWithTurnix(token, url(), forceRelay, ""), new ObjectMapper(), clock);
    }

    private ApiException failure(String token, boolean forceRelay) {
        ApiException e = catchThrowableOfType(ApiException.class, () -> service(token, forceRelay).forClient("203.0.113.7"));
        assertThat(e).as("expected an ApiException").isNotNull();
        return e;
    }

    @Test
    void issuesCredentialsFromTurnixWithBearerTokenTtlAndClientIp() {
        var config = service(TOKEN, false).forClient("203.0.113.7");

        assertThat(auth.get()).isEqualTo("Bearer " + TOKEN);
        assertThat(clientIp.get()).isEqualTo("203.0.113.7");
        assertThat(contentType.get()).isEqualTo("application/json");
        assertThat(body.get()).isEqualTo("{\"ttl\":3600}");

        assertThat(config.turnConfigured()).isTrue();
        assertThat(config.forceRelay()).isFalse();
        assertThat(config.ttlSeconds()).isEqualTo(3600);
        assertThat(config.expiresAt()).isEqualTo(Instant.parse("2026-11-10T11:00:00Z"));
        assertThat(config.iceServers()).hasSize(2);
        assertThat(config.iceServers().get(0).username()).isNull();
        var turn = config.iceServers().get(1);
        assertThat(turn.username()).isEqualTo("4d6c-uuid");
        assertThat(turn.credential()).isEqualTo("cred-abc");
        assertThat(turn.urls()).containsExactly("turn:eu.turnix.io:3478?transport=udp", "turns:eu.turnix.io:443?transport=tcp"); // non-ICE url dropped
    }

    @Test
    void noClientIpHeaderIsSentWhenTheIpIsUnknown() {
        service(TOKEN, false).forClient(null);
        assertThat(clientIp.get()).isNull();
    }

    @Test
    void forceRelayIsReportedFromConfiguration() {
        assertThat(service(TOKEN, true).forClient("203.0.113.7").forceRelay()).isTrue();
    }

    @Test
    void theApiTokenIsNeverInTheResponseObject() throws Exception {
        String json = new ObjectMapper().findAndRegisterModules().writeValueAsString(service(TOKEN, false).forClient("203.0.113.7"));
        assertThat(json).doesNotContain(TOKEN).doesNotContain("Bearer");
    }

    @Test
    void missingTokenIsAClearConfigurationErrorAndNoRequestIsMade() {
        for (String missing : new String[]{"", "  ", null}) {
            ApiException e = failure(missing, true);
            assertThat(e.code()).isEqualTo("TURN_NOT_CONFIGURED");
            assertThat(e.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        }
        assertThat(calls.get()).isZero();
    }

    @Test
    void invalidTokenIsReportedAsBackendConfigurationWithoutExposingIt() {
        status = 401;
        reply = "{\"error\":\"Token not found\",\"code\":\"unauthorized\"}";
        ApiException e = failure(TOKEN, false);
        assertThat(e.code()).isEqualTo("TURN_PROVIDER_AUTH");
        assertThat(e.status()).isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(e.getMessage()).doesNotContain(TOKEN).doesNotContain("Token not found");
    }

    @Test
    void usageLimitIsAClearErrorWithoutLeakingUsageNumbers() {
        status = 429;
        reply = "{\"error\":\"Usage limit exceeded\",\"message\":\"You have reached your data usage limit\",\"limit\":\"15 GB\",\"used\":\"15.02 GB\"}";
        ApiException e = failure(TOKEN, false);
        assertThat(e.code()).isEqualTo("TURN_USAGE_LIMIT");
        assertThat(e.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(e.getMessage()).contains("usage limit").doesNotContain("15");
    }

    @Test
    void otherProviderFailuresAreSafeErrors() {
        for (int s : new int[]{422, 500, 503}) {
            status = s;
            reply = "{\"error\":\"internal detail with " + TOKEN + "\"}";
            ApiException e = failure(TOKEN, true);
            assertThat(e.code()).isEqualTo("TURN_PROVIDER_ERROR");
            assertThat(e.getMessage()).doesNotContain(TOKEN).doesNotContain("internal detail");
        }
    }

    @Test
    void aSlowProviderTimesOutAfterTenSecondsInsteadOfHanging() {
        delayMs = 12_000;
        long t0 = System.nanoTime();
        ApiException e = failure(TOKEN, true);
        long seconds = (System.nanoTime() - t0) / 1_000_000_000L;
        assertThat(e.code()).isEqualTo("TURN_PROVIDER_TIMEOUT");
        assertThat(e.status()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);
        assertThat(seconds).isBetween(9L, 12L);
    }

    @Test
    void anUnreachableProviderIsASafeError() {
        server.stop(0);
        ApiException e = failure(TOKEN, true);
        assertThat(e.code()).isEqualTo("TURN_PROVIDER_UNAVAILABLE");
        assertThat(e.getMessage()).doesNotContain("127.0.0.1").doesNotContain(TOKEN);
    }

    @Test
    void aReplyWithoutAnyTurnServerIsRejectedNeverReturnedAsStunOnly() {
        reply = "{\"iceServers\":[{\"urls\":[\"stun:stun.turnix.io:3478\"]}]," + EXPIRES + "}";
        assertThat(failure(TOKEN, true).code()).isEqualTo("TURN_PROVIDER_ERROR");
        assertThat(failure(TOKEN, false).code()).isEqualTo("TURN_PROVIDER_ERROR");
        reply = "not json";
        assertThat(failure(TOKEN, true).code()).isEqualTo("TURN_PROVIDER_ERROR");
    }

    @Test
    void anAbsurdOrMissingExpiryFallsBackToTheRequestedLifetime() {
        Instant fallback = Instant.parse("2026-11-10T11:00:00Z");
        reply = GOOD.replace("2026-11-10T11:00:00.000Z", "2099-01-01T00:00:00Z");
        assertThat(service(TOKEN, false).forClient(null).expiresAt()).isEqualTo(fallback);
        reply = GOOD.replace("," + EXPIRES, "");
        assertThat(service(TOKEN, false).forClient(null).expiresAt()).isEqualTo(fallback);
    }

    @Test
    void redirectsAreNotFollowedSoTheTokenCannotBeForwarded() {
        server.createContext("/redir", ex -> {
            ex.getResponseHeaders().add("Location", url());
            ex.sendResponseHeaders(307, -1);
            ex.close();
        });
        var svc = new IceServerService(TestSupport.propsWithTurnix(TOKEN, url().replace("/api/v1/credentials/ice", "/redir"), false, ""), new ObjectMapper(), clock);
        ApiException e = catchThrowableOfType(ApiException.class, () -> svc.forClient(null));
        assertThat(e).isNotNull();
        assertThat(calls.get()).isZero();
    }

    @Test
    void theTokenAndCredentialsAreNeverLogged() {
        status = 401;
        failure(TOKEN, true);
        status = 429;
        failure(TOKEN, true);
        status = 200;
        service(TOKEN, false).forClient("203.0.113.7");
        failure("", true);
        String all = String.join("\n", logs.list.stream().map(ILoggingEvent::getFormattedMessage).toList());
        assertThat(logs.list).isNotEmpty();
        assertThat(all).doesNotContain(TOKEN).doesNotContain("cred-abc").doesNotContain("4d6c-uuid").doesNotContain("Bearer");
    }
}
