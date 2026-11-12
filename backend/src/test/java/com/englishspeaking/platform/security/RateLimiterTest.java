package com.englishspeaking.platform.security;

import com.englishspeaking.platform.TestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RateLimiterTest {
    @Test
    void fallsBackToLocalWindowWhenRedisIsDown() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.opsForValue()).thenThrow(new RedisConnectionFailureException("down"));
        var clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z"));
        var limiter = new RateLimiter(redis, clock);

        for (int i = 0; i < 3; i++) assertThat(limiter.tryAcquire("k", 3, Duration.ofMinutes(1))).isTrue();
        assertThat(limiter.tryAcquire("k", 3, Duration.ofMinutes(1))).isFalse();
        assertThat(limiter.tryAcquire("other", 3, Duration.ofMinutes(1))).isTrue();

        clock.advance(Duration.ofMinutes(2));
        assertThat(limiter.tryAcquire("k", 3, Duration.ofMinutes(1))).isTrue();
    }
}
