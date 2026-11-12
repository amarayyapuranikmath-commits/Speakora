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

/** Makes WebSocket tickets single-use: the first handshake consumes the ticket id, any replay is refused. */
@Component
public class TicketReplayGuard {
    private static final Logger log = LoggerFactory.getLogger(TicketReplayGuard.class);
    private static final Duration TTL = Duration.ofSeconds(90);

    private final StringRedisTemplate redis;
    private final Clock clock;
    private final Map<String, Long> local = new ConcurrentHashMap<>();

    public TicketReplayGuard(StringRedisTemplate redis, Clock clock) {
        this.redis = redis;
        this.clock = clock;
    }

    /** @return true exactly once per ticket id. */
    public boolean consume(String ticketId) {
        long now = clock.millis();
        if (local.size() > 10_000) local.values().removeIf(exp -> exp < now);
        if (local.putIfAbsent(ticketId, now + TTL.toMillis()) != null) return false;
        try {
            Boolean first = redis.opsForValue().setIfAbsent("wsticket:" + ticketId, "1", TTL);
            return first == null || first;
        } catch (DataAccessException e) {
            log.warn("Redis unavailable for ticket replay check; enforcing single use on this instance only");
            return true;
        }
    }
}
