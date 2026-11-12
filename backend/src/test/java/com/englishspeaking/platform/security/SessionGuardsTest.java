package com.englishspeaking.platform.security;

import com.englishspeaking.platform.TestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** With Redis unreachable the guards still work on this instance rather than failing open or throwing. */
class SessionGuardsTest {
    private final TestSupport.MutableClock clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z"));
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

    SessionGuardsTest() { when(redis.opsForValue()).thenThrow(new RedisConnectionFailureException("down")); when(redis.hasKey(org.mockito.ArgumentMatchers.anyString())).thenThrow(new RedisConnectionFailureException("down")); }

    @Test
    void revokedSessionsAreRejectedImmediatelyEvenWithoutRedis() {
        var revoked = new RevokedSessions(redis, clock);
        UUID user = UUID.randomUUID();
        assertThat(revoked.isBlocked(user)).isFalse();
        revoked.block(user);
        assertThat(revoked.isBlocked(user)).isTrue();
        revoked.unblock(user);
        assertThat(revoked.isBlocked(user)).isFalse();
    }

    @Test
    void revocationExpiresWhenAllOldTokensHaveExpiredAnyway() {
        var revoked = new RevokedSessions(redis, clock);
        UUID user = UUID.randomUUID();
        revoked.block(user);
        clock.advance(Duration.ofMinutes(31));
        assertThat(revoked.isBlocked(user)).isFalse();
    }

    @Test
    void aWebSocketTicketCanBeUsedExactlyOnce() {
        var guard = new TicketReplayGuard(redis, clock);
        assertThat(guard.consume("ticket-1")).isTrue();
        assertThat(guard.consume("ticket-1")).isFalse();
        assertThat(guard.consume("ticket-2")).isTrue();
    }

    @Test
    void eachIssuedTicketCarriesAUniqueId() {
        var jwt = new JwtService(TestSupport.props(), clock);
        UUID user = UUID.randomUUID();
        var a = jwt.parseWsTicket(jwt.createWsTicket(user)).orElseThrow();
        var b = jwt.parseWsTicket(jwt.createWsTicket(user)).orElseThrow();
        assertThat(a.ticketId()).isNotBlank().isNotEqualTo(b.ticketId());
    }
}
