package com.englishspeaking.platform.matching;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Says at startup, once, whether Redis (matchmaking, rate limits, sign-in tickets) can be reached, and if not, the most likely reason, so a
 * hosted-Redis mistake does not have to be guessed from a timeout. Host, port and TLS are not secrets; the password is never read or logged.
 * It never stops the application: Redis problems are reported and the rest of the API keeps working.
 */
@Component
public class RedisStartupCheck {
    private static final Logger log = LoggerFactory.getLogger(RedisStartupCheck.class);

    private final StringRedisTemplate redis;
    private final String host;
    private final int port;
    private final boolean tls;

    public RedisStartupCheck(StringRedisTemplate redis, @Value("${spring.data.redis.host:localhost}") String host,
                             @Value("${spring.data.redis.port:6379}") int port, @Value("${spring.data.redis.ssl.enabled:false}") boolean tls) {
        this.redis = redis;
        this.host = host;
        this.port = port;
        this.tls = tls;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        String setting = settingProblem(host, tls);
        if (setting != null) log.warn("Redis setting: {}", setting);
        Thread.ofVirtual().name("redis-startup-check").start(this::ping); // the first connection can take seconds; do not delay startup
    }

    void ping() {
        long t0 = System.nanoTime();
        try {
            String pong = redis.execute((org.springframework.data.redis.core.RedisCallback<String>) c -> c.ping());
            log.info("Redis reachable at {}:{} (TLS {}): {} in {} ms", host, port, tls ? "on" : "off", pong, (System.nanoTime() - t0) / 1_000_000);
        } catch (RuntimeException e) {
            log.error("Redis NOT reachable at {}:{} (TLS {}) after {} ms: {}. {}", host, port, tls ? "on" : "off", (System.nanoTime() - t0) / 1_000_000,
                    rootCause(e).getClass().getSimpleName(), hint(host, tls, e));
        }
    }

    /** A mistake that is certain from the settings alone, or null. */
    static String settingProblem(String host, boolean tls) {
        String h = host == null ? "" : host.toLowerCase(java.util.Locale.ROOT);
        if (h.startsWith("redis://") || h.startsWith("rediss://")) return "REDIS_HOST must be only the host name (for example abc-123.upstash.io), not a URL";
        if (h.contains(":") && !h.startsWith("[")) return "REDIS_HOST must not include a port; put it in REDIS_PORT";
        if (isHostedTlsOnly(h) && !tls) return "REDIS_HOST looks like a hosted Redis that only accepts TLS; set REDIS_SSL=true";
        return null;
    }

    static String hint(String host, boolean tls, Throwable e) {
        String h = host == null ? "" : host.toLowerCase(java.util.Locale.ROOT);
        String cause = rootCause(e).getClass().getSimpleName();
        if (isHostedTlsOnly(h) && !tls) return "This host only accepts TLS: set REDIS_SSL=true.";
        if (cause.contains("Timeout")) {
            return tls ? "The connection did not finish in time: check REDIS_HOST and REDIS_PORT, put Redis in the same region as the server, or raise SPRING_DATA_REDIS_TIMEOUT and SPRING_DATA_REDIS_CONNECT_TIMEOUT (for example 5s)."
                       : "The connection did not finish in time. If the provider needs TLS (hosted Redis usually does), set REDIS_SSL=true; otherwise check host, port and the network.";
        }
        if (cause.contains("UnknownHost")) return "The host name was not found: check REDIS_HOST.";
        if (cause.contains("ConnectException")) return "The connection was refused: check REDIS_PORT and that Redis is running.";
        if (cause.contains("Authentication") || String.valueOf(rootCause(e).getMessage()).contains("WRONGPASS") || String.valueOf(rootCause(e).getMessage()).contains("NOAUTH")) {
            return "Redis refused the password: check REDIS_PASSWORD.";
        }
        if (cause.contains("SSL") || cause.contains("Certificate") || cause.contains("Handshake")) return "The TLS handshake failed: check REDIS_SSL and REDIS_PORT (the TLS port).";
        return "Check REDIS_HOST, REDIS_PORT, REDIS_PASSWORD and REDIS_SSL.";
    }

    private static boolean isHostedTlsOnly(String host) { return host.endsWith(".upstash.io") || host.endsWith(".redis-cloud.com") || host.endsWith(".redislabs.com"); }

    private static Throwable rootCause(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        return t;
    }
}
