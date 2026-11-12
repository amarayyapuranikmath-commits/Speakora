package com.englishspeaking.platform.matching;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class MatchmakingSweeper {
    private static final Logger log = LoggerFactory.getLogger(MatchmakingSweeper.class);

    private final MatchmakingService matchmaking;

    public MatchmakingSweeper(MatchmakingService matchmaking) { this.matchmaking = matchmaking; }

    @Scheduled(fixedDelay = 3000)
    public void run() {
        try {
            matchmaking.sweep();
        } catch (RedisConnectionFailureException e) {
            log.warn("Matchmaking sweep skipped: Redis unavailable");
        }
    }
}
