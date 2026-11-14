package com.englishspeaking.platform.security;

import com.englishspeaking.platform.TestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RateLimiterTest {
    @Test
    void fallsBackToLocalWindowWhenRedisIsDown() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), anyList(), any(Object[].class))).thenThrow(new RedisConnectionFailureException("down"));
        var clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z"));
        var limiter = new RateLimiter(redis, clock);

        for (int i = 0; i < 3; i++) assertThat(limiter.tryAcquire("k", 3, Duration.ofMinutes(1))).isTrue();
        assertThat(limiter.tryAcquire("k", 3, Duration.ofMinutes(1))).isFalse();
        assertThat(limiter.tryAcquire("other", 3, Duration.ofMinutes(1))).isTrue();

        clock.advance(Duration.ofMinutes(2));
        assertThat(limiter.tryAcquire("k", 3, Duration.ofMinutes(1))).isTrue();
    }

    @Test
    void theLocalOnlyLimiterUsedForWebSocketMessagesNeverCallsRedisAndStillEnforcesAndExpiresTheWindow() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        var clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z"));
        var limiter = new RateLimiter(redis, clock);
        for (int i = 0; i < 300; i++) assertThat(limiter.tryAcquireLocalOnly("ws:user", 300, Duration.ofSeconds(10))).isTrue();
        assertThat(limiter.tryAcquireLocalOnly("ws:user", 300, Duration.ofSeconds(10))).isFalse(); // the 301st message in the window is refused
        assertThat(limiter.tryAcquireLocalOnly("ws:other", 300, Duration.ofSeconds(10))).isTrue(); // another person is counted separately
        clock.advance(Duration.ofSeconds(11));
        assertThat(limiter.tryAcquireLocalOnly("ws:user", 300, Duration.ofSeconds(10))).isTrue(); // the window expired
        org.mockito.Mockito.verifyNoInteractions(redis);
    }

    @Test
    void aSharedLimitCountsThroughOneRedisCallAndAnOutageDoesNotLetEveryoneThroughForFree() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), anyList(), any(Object[].class))).thenReturn(1L, 2L, 3L);
        var limiter = new RateLimiter(redis, new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z")));
        assertThat(limiter.tryAcquire("k", 2, Duration.ofMinutes(1))).isTrue();
        assertThat(limiter.tryAcquire("k", 2, Duration.ofMinutes(1))).isTrue();
        assertThat(limiter.tryAcquire("k", 2, Duration.ofMinutes(1))).isFalse();
        org.mockito.Mockito.verify(redis, org.mockito.Mockito.times(3)).execute(any(org.springframework.data.redis.core.script.RedisScript.class), anyList(), any(Object[].class));
        org.mockito.Mockito.verify(redis, org.mockito.Mockito.never()).expire(any(String.class), any(Duration.class)); // no separate EXPIRE call any more
    }

    @Test
    void severalConnectionsOfOneUserShareOneBucketSoOpeningMoreSocketsDoesNotRaiseTheLimit() {
        var limiter = new RateLimiter(mock(StringRedisTemplate.class), new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z")));
        String key = "ws:" + java.util.UUID.randomUUID(); // the key is the user, not the connection
        int allowed = 0;
        for (int i = 0; i < 1000; i++) { // 1000 messages spread over "five sockets"
            if (limiter.tryAcquireLocalOnly(key, 300, Duration.ofSeconds(10))) allowed++;
        }
        assertThat(allowed).isEqualTo(300);
    }

    @Test
    void reconnectingDoesNotResetTheWindow() {
        var clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z"));
        var limiter = new RateLimiter(mock(StringRedisTemplate.class), clock);
        for (int i = 0; i < 300; i++) limiter.tryAcquireLocalOnly("ws:u", 300, Duration.ofSeconds(10));
        clock.advance(Duration.ofSeconds(3)); // the socket was closed for sending too much and the client reconnected
        assertThat(limiter.tryAcquireLocalOnly("ws:u", 300, Duration.ofSeconds(10))).isFalse();
    }
}
