package com.englishspeaking.platform.matching;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Temporary matchmaking state (queue, presence, "in a call" markers). Implementations must make
 * {@link #tryClaim} atomic: it is the only thing standing between two matchers and a double-booked user.
 */
public interface MatchmakingStore {
    void enqueue(QueueEntry entry);

    boolean remove(UUID userId);

    boolean contains(UUID userId);

    /** Oldest waiting entries first. */
    List<QueueEntry> candidates(int limit);

    /**
     * Atomically: both users are queued and neither is in a call -> remove both from the queue and mark both
     * as being in {@code callId}. Returns false (and changes nothing) otherwise.
     */
    boolean tryClaim(UUID a, UUID b, UUID callId);

    /**
     * Atomically: neither user is in a call -> remove both from the queue if they are waiting (they need not be) and mark both
     * as being in {@code callId}. Used when two people who agreed to talk (a previous-partner request) are connected directly.
     */
    boolean claimDirect(UUID a, UUID b, UUID callId);

    /** Clears the in-call marker for each user, but only if it still points at {@code callId}. */
    void releaseCall(UUID callId, Collection<UUID> users);

    Optional<UUID> activeCall(UUID userId);

    void touchPresence(UUID userId);

    void clearPresence(UUID userId);

    boolean isOnline(UUID userId);

    Set<UUID> recentPartners(UUID userId);

    void rememberPair(UUID a, UUID b);
}
