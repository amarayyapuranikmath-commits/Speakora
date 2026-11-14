package com.englishspeaking.platform.matching;

import io.lettuce.core.RedisCommandTimeoutException;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.doThrow;

class RedisStartupCheckTest {
    private static final String UPSTASH = "fine-owl-12345.upstash.io";

    @Test
    void aHostedTlsOnlyHostWithoutTlsIsFlaggedFromTheSettingsAlone() {
        assertThat(RedisStartupCheck.settingProblem(UPSTASH, false)).contains("REDIS_SSL=true");
        assertThat(RedisStartupCheck.settingProblem(UPSTASH, true)).isNull();
        assertThat(RedisStartupCheck.settingProblem("localhost", false)).isNull();
    }

    @Test
    void aUrlOrAPortInTheHostIsFlagged() {
        assertThat(RedisStartupCheck.settingProblem("rediss://" + UPSTASH, true)).contains("not a URL");
        assertThat(RedisStartupCheck.settingProblem(UPSTASH + ":6379", true)).contains("REDIS_PORT");
    }

    @Test
    void theInitializationTimeoutIsExplainedByTheMissingTlsFirst() {
        var timeout = new RedisConnectionFailureException("Unable to connect to Redis", new RedisCommandTimeoutException("Connection initialization timed out after 2 second(s)"));
        assertThat(RedisStartupCheck.hint(UPSTASH, false, timeout)).contains("REDIS_SSL=true");
        assertThat(RedisStartupCheck.hint("my-redis.internal", false, timeout)).contains("TLS").contains("REDIS_SSL=true");
        assertThat(RedisStartupCheck.hint(UPSTASH, true, timeout)).contains("SPRING_DATA_REDIS_TIMEOUT").contains("same region");
    }

    @Test
    void otherCausesGetTheirOwnHintAndNeverRepeatThePassword() {
        assertThat(RedisStartupCheck.hint(UPSTASH, true, new RuntimeException(new java.net.UnknownHostException(UPSTASH)))).contains("REDIS_HOST");
        assertThat(RedisStartupCheck.hint(UPSTASH, true, new RuntimeException(new java.net.ConnectException("refused")))).contains("REDIS_PORT");
        assertThat(RedisStartupCheck.hint(UPSTASH, true, new RuntimeException("WRONGPASS invalid username-password pair"))).contains("REDIS_PASSWORD");
    }

    @Test
    void aFailedPingIsReportedAndNeverThrownSoStartupContinues() {
        var redis = mock(org.springframework.data.redis.core.StringRedisTemplate.class);
        doThrow(new RedisConnectionFailureException("down", new RedisCommandTimeoutException("Connection initialization timed out after 2 second(s)")))
                .when(redis).execute(org.mockito.ArgumentMatchers.<org.springframework.data.redis.core.RedisCallback<String>>any());
        new RedisStartupCheck(redis, UPSTASH, 6379, false).ping(); // must not throw
        verify(redis).execute(org.mockito.ArgumentMatchers.<org.springframework.data.redis.core.RedisCallback<String>>any());
    }
}
