package com.englishspeaking.platform.calling;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.util.EnumSet;
import java.util.UUID;

/** Times out calls whose peers never established media, so nothing stays "active" forever. */
@Component
public class CallJanitor {
    private static final Logger log = LoggerFactory.getLogger(CallJanitor.class);
    static final Duration SETUP_TIMEOUT = Duration.ofSeconds(90);
    static final Duration MAX_CALL = Duration.ofHours(3);

    private final CallSessionRepository sessions;
    private final CallService calls;
    private final Clock clock;

    public CallJanitor(CallSessionRepository sessions, CallService calls, Clock clock) {
        this.sessions = sessions;
        this.calls = calls;
        this.clock = clock;
    }

    @Scheduled(fixedDelay = 30_000)
    public void sweep() {
        endAll(sessions.findStaleIds(EnumSet.of(CallStatus.MATCH_FOUND, CallStatus.CONNECTING), clock.instant().minus(SETUP_TIMEOUT)), EndReason.TIMEOUT);
        endAll(sessions.findStaleIds(EnumSet.of(CallStatus.CONNECTED, CallStatus.RECONNECTING), clock.instant().minus(MAX_CALL)), EndReason.TIMEOUT);
    }

    private void endAll(Iterable<UUID> ids, EndReason reason) {
        for (UUID id : ids) {
            try {
                calls.end(id, null, reason);
            } catch (RuntimeException e) {
                log.warn("Could not time out call {}: {}", id, e.getMessage());
            }
        }
    }
}
