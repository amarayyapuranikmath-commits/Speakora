package com.englishspeaking.platform.matching;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class QueueTimingTest {
    @Test
    void aWaitingEntryOutlivesTheSearchLimit() {
        // A queue entry that expires before the search limit silently drops a waiting person while their screen still says "searching".
        assertThat(RedisMatchmakingStore.ENTRY_TTL).isGreaterThan(Duration.ofMillis(MatchmakingService.QUEUE_TIMEOUT_MILLIS));
    }
}
