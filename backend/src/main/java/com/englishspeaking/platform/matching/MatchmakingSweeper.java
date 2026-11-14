package com.englishspeaking.platform.matching;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class MatchmakingSweeper {
    private static final Logger log = LoggerFactory.getLogger(MatchmakingSweeper.class);

    private static final long WARN_EVERY_MILLIS = 60_000;

    private final MatchmakingService matchmaking;
    private long lastWarnAt = -WARN_EVERY_MILLIS;

    public MatchmakingSweeper(MatchmakingService matchmaking) { this.matchmaking = matchmaking; }

    @Scheduled(fixedDelay = 3000)
    public void run() {
        try {
            matchmaking.sweep();
        } catch (RedisConnectionFailureException | QueryTimeoutException e) { // a timeout on a connected Redis is the same outage
            long now = System.currentTimeMillis();
            if (now - lastWarnAt >= WARN_EVERY_MILLIS) { // the sweep runs every 3 s: say why at most once a minute
                lastWarnAt = now;
                Throwable root = e;
                while (root.getCause() != null && root.getCause() != root) root = root.getCause();
                log.warn("Matchmaking sweep skipped: Redis unavailable ({}: {})", root.getClass().getSimpleName(), root.getMessage());
            }
        }
    }
}
