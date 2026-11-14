package com.englishspeaking.platform.security;

import com.englishspeaking.platform.LocalRedis;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/** The atomic one-round-trip counter against a real Redis: limits, expiry, and that a window can never be left without an expiry. */
class RateLimiterRedisTest {
    StringRedisTemplate redis;
    RateLimiter limiter;

    @BeforeEach
    void setUp() {
        redis = LocalRedis.template();
        limiter = new RateLimiter(redis, Clock.systemUTC());
    }

    @Test
    void theFirstHitStartsTheWindowAtomicallyAndTheLimitHolds() {
        for (int i = 0; i < 3; i++) assertThat(limiter.tryAcquire("k1", 3, Duration.ofSeconds(30))).isTrue();
        assertThat(limiter.tryAcquire("k1", 3, Duration.ofSeconds(30))).isFalse();
        Long ttl = redis.getExpire("rl:k1", TimeUnit.MILLISECONDS);
        assertThat(ttl).isBetween(1L, 30_000L); // a counter is never left without an expiry
    }

    @Test
    void laterHitsDoNotExtendTheWindow() throws Exception {
        limiter.tryAcquire("k2", 100, Duration.ofSeconds(5));
        Thread.sleep(300);
        long before = redis.getExpire("rl:k2", TimeUnit.MILLISECONDS);
        limiter.tryAcquire("k2", 100, Duration.ofSeconds(5));
        long after = redis.getExpire("rl:k2", TimeUnit.MILLISECONDS);
        assertThat(after).isLessThanOrEqualTo(before); // fixed window: it keeps running down
    }

    @Test
    void theCounterResetsWhenTheWindowExpires() throws Exception {
        assertThat(limiter.tryAcquire("k3", 1, Duration.ofMillis(400))).isTrue();
        assertThat(limiter.tryAcquire("k3", 1, Duration.ofMillis(400))).isFalse();
        Thread.sleep(700);
        assertThat(limiter.tryAcquire("k3", 1, Duration.ofMillis(400))).isTrue();
    }

    @Test
    void hundredsOfConcurrentCallsAllowExactlyTheLimit() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(24);
        AtomicInteger allowed = new AtomicInteger();
        List<Future<?>> all = new ArrayList<>();
        for (int i = 0; i < 300; i++) all.add(pool.submit(() -> { if (limiter.tryAcquire("k4", 120, Duration.ofSeconds(30))) allowed.incrementAndGet(); }));
        for (Future<?> f : all) f.get(30, TimeUnit.SECONDS);
        pool.shutdown();
        assertThat(allowed.get()).isEqualTo(120);
        assertThat(redis.getExpire("rl:k4", TimeUnit.MILLISECONDS)).isPositive();
    }

    @Test
    void differentKeysAreCountedSeparately() {
        assertThat(limiter.tryAcquire("a", 1, Duration.ofSeconds(30))).isTrue();
        assertThat(limiter.tryAcquire("b", 1, Duration.ofSeconds(30))).isTrue();
        assertThat(limiter.tryAcquire("a", 1, Duration.ofSeconds(30))).isFalse();
    }

    @Test
    void theCounterStillWorksAfterTheServerForgetsItsCachedScripts() {
        assertThat(limiter.tryAcquire("n1", 2, Duration.ofSeconds(30))).isTrue();
        redis.execute((org.springframework.data.redis.core.RedisCallback<Object>) c -> { c.scriptingCommands().scriptFlush(); return null; });
        assertThat(limiter.tryAcquire("n1", 2, Duration.ofSeconds(30))).isTrue(); // EVALSHA gets NOSCRIPT, then the script is sent in full
        assertThat(limiter.tryAcquire("n1", 2, Duration.ofSeconds(30))).isFalse();
        assertThat(redis.getExpire("rl:n1", TimeUnit.MILLISECONDS)).isPositive();
    }
}
