package com.englishspeaking.platform.calling;

import java.util.List;
import java.util.UUID;

/** Domain events so the websocket and matching modules react to calls without depending on each other. */
public final class CallEvents {
    private CallEvents() {}

    /** {@code initiatorId} creates the WebRTC offer. */
    public record MatchFound(UUID callId, UUID initiatorId, UUID otherId, UUID topicId, CallKind kind) {
        public MatchFound(UUID callId, UUID initiatorId, UUID otherId, UUID topicId) { this(callId, initiatorId, otherId, topicId, CallKind.RANDOM); }
    }

    /** {@code endedBy} is null for system-initiated changes (timeouts). */
    public record StateChanged(UUID callId, CallStatus status, EndReason endReason, UUID endedBy,
                               Integer durationSeconds, List<UUID> participantIds) {}
}
