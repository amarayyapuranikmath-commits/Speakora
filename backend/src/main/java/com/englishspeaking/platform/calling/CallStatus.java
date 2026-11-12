package com.englishspeaking.platform.calling;

import java.util.EnumSet;
import java.util.Set;

/**
 * Server-side call lifecycle. IDLE and SEARCHING are client/queue states only: a call row does not exist
 * until two users have been matched.
 */
public enum CallStatus {
    MATCH_FOUND, CONNECTING, CONNECTED, RECONNECTING, COMPLETED, FAILED, CANCELLED;

    private static final Set<CallStatus> ACTIVE = EnumSet.of(MATCH_FOUND, CONNECTING, CONNECTED, RECONNECTING);

    public boolean isTerminal() { return !ACTIVE.contains(this); }

    public static Set<CallStatus> activeStatuses() { return ACTIVE; }

    public boolean canTransitionTo(CallStatus next) {
        return switch (this) {
            case MATCH_FOUND -> next == CONNECTING || next == CANCELLED || next == FAILED;
            case CONNECTING -> next == CONNECTED || next == CANCELLED || next == FAILED;
            case CONNECTED -> next == RECONNECTING || next == COMPLETED;
            case RECONNECTING -> next == CONNECTED || next == COMPLETED || next == FAILED;
            case COMPLETED, FAILED, CANCELLED -> false;
        };
    }
}
