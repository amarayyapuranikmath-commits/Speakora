package com.englishspeaking.platform.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Fixed-window rate limiter. Uses Redis so limits hold across instances; if Redis is unreachable it
 * degrades to a per-instance in-memory window instead of failing open.
 */
@Component
public class RateLimiter {
    private static final Logger log = LoggerFactory.getLogger(RateLimiter.class);

    /**
     * Count one hit and start the window on the first one, in a single Redis round trip. Before, INCR and PEXPIRE were two sequential calls on the
     * first hit of every window (and a crash between them left a counter that never expired). KEYS: the counter. ARGV: the window in milliseconds.
     */
    private static final DefaultRedisScript<Long> HIT = new DefaultRedisScript<>("""
            local count = redis.call('INCR', KEYS[1])
            if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
            return count
            """, Long.class);

    private final StringRedisTemplate redis;
    private final Clock clock;
    private final Map<String, Window> local = new ConcurrentHashMap<>();

    public RateLimiter(StringRedisTemplate redis, Clock clock) {
        this.redis = redis;
        this.clock = clock;
    }

    /** @return true if the call is within the limit. */
    public boolean tryAcquire(String key, int limit, Duration window) {
        try {
            Long count = redis.execute(HIT, java.util.List.of("rl:" + key), String.valueOf(window.toMillis()));
            return count == null || count <= limit;
        } catch (DataAccessException e) {
            log.warn("Redis unavailable for rate limiting, using local window: {}", e.getMessage());
            return tryAcquireLocal(key, limit, window);
        }
    }

    /**
     * Same fixed window, kept in this instance's memory only: no Redis call at all. For limits that belong to one connection (WebSocket messages: a
     * user has exactly one live socket, because a new one replaces the old), where a shared counter adds a network round trip and no protection.
     */
    public boolean tryAcquireLocalOnly(String key, int limit, Duration window) { return tryAcquireLocal(key, limit, window); }

    boolean tryAcquireLocal(String key, int limit, Duration window) {
        long now = clock.millis();
        if (local.size() > 50_000) local.entrySet().removeIf(e -> e.getValue().resetAt < now);
        Window w = local.compute(key, (k, cur) -> cur == null || cur.resetAt < now
                ? new Window(now + window.toMillis(), 1) : new Window(cur.resetAt, cur.count + 1));
        return w.count <= limit;
    }

    private record Window(long resetAt, int count) {}
}
