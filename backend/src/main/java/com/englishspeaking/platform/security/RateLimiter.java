package com.englishspeaking.platform.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
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
            String redisKey = "rl:" + key;
            Long count = redis.opsForValue().increment(redisKey);
            if (count != null && count == 1L) redis.expire(redisKey, window);
            return count == null || count <= limit;
        } catch (DataAccessException e) {
            log.warn("Redis unavailable for rate limiting, using local window: {}", e.getMessage());
            return tryAcquireLocal(key, limit, window);
        }
    }

    boolean tryAcquireLocal(String key, int limit, Duration window) {
        long now = clock.millis();
        if (local.size() > 50_000) local.entrySet().removeIf(e -> e.getValue().resetAt < now);
        Window w = local.compute(key, (k, cur) -> cur == null || cur.resetAt < now
                ? new Window(now + window.toMillis(), 1) : new Window(cur.resetAt, cur.count + 1));
        return w.count <= limit;
    }

    private record Window(long resetAt, int count) {}
}
