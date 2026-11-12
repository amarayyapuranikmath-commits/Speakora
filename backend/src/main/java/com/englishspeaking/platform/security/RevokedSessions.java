package com.englishspeaking.platform.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Access tokens are stateless, so suspending or deleting an account must also invalidate the tokens already issued.
 * Blocked user ids are kept for slightly longer than an access token lives; after that every token is expired anyway.
 * Redis is the shared store; a local map keeps the guarantee if Redis is down (per instance only).
 */
@Component
public class RevokedSessions {
    private static final Logger log = LoggerFactory.getLogger(RevokedSessions.class);
    private static final Duration TTL = Duration.ofMinutes(30);

    private final StringRedisTemplate redis;
    private final Clock clock;
    private final Map<UUID, Long> local = new ConcurrentHashMap<>();

    public RevokedSessions(StringRedisTemplate redis, Clock clock) {
        this.redis = redis;
        this.clock = clock;
    }

    public void block(UUID userId) {
        local.put(userId, clock.millis() + TTL.toMillis());
        try {
            redis.opsForValue().set(key(userId), "1", TTL);
        } catch (DataAccessException e) {
            log.warn("Redis unavailable while revoking sessions for {}; revoked on this instance only", userId);
        }
    }

    public void unblock(UUID userId) {
        local.remove(userId);
        try {
            redis.delete(key(userId));
        } catch (DataAccessException e) {
            log.warn("Redis unavailable while clearing revocation for {}", userId);
        }
    }

    public boolean isBlocked(UUID userId) {
        Long until = local.get(userId);
        if (until != null) {
            if (until > clock.millis()) return true;
            local.remove(userId);
        }
        try {
            return Boolean.TRUE.equals(redis.hasKey(key(userId)));
        } catch (DataAccessException e) {
            return false; // fail open: the database still rejects suspended users at login/refresh/matching
        }
    }

    private static String key(UUID id) { return "revoked:" + id; }
}
