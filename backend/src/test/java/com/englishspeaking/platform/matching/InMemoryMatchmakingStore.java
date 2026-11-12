package com.englishspeaking.platform.matching;

import java.util.*;

/** Test double with the same atomicity contract as the Redis store (one lock guards every compound operation). */
class InMemoryMatchmakingStore implements MatchmakingStore {
    private final LinkedHashMap<UUID, QueueEntry> queue = new LinkedHashMap<>();
    private final Map<UUID, UUID> active = new HashMap<>();
    private final Set<UUID> online = new HashSet<>();
    private final Map<UUID, Set<UUID>> recent = new HashMap<>();

    @Override public synchronized void enqueue(QueueEntry entry) { queue.put(entry.userId(), entry); }
    @Override public synchronized boolean remove(UUID userId) { return queue.remove(userId) != null; }
    @Override public synchronized boolean contains(UUID userId) { return queue.containsKey(userId); }

    @Override
    public synchronized List<QueueEntry> candidates(int limit) {
        return queue.values().stream().sorted(Comparator.comparingLong(QueueEntry::enqueuedAtMillis)).limit(limit).toList();
    }

    @Override
    public synchronized boolean tryClaim(UUID a, UUID b, UUID callId) {
        if (active.containsKey(a) || active.containsKey(b) || !queue.containsKey(a) || !queue.containsKey(b)) return false;
        queue.remove(a);
        queue.remove(b);
        active.put(a, callId);
        active.put(b, callId);
        return true;
    }

    @Override
    public synchronized boolean claimDirect(UUID a, UUID b, UUID callId) {
        if (active.containsKey(a) || active.containsKey(b)) return false;
        queue.remove(a);
        queue.remove(b);
        active.put(a, callId);
        active.put(b, callId);
        return true;
    }

    @Override
    public synchronized void releaseCall(UUID callId, Collection<UUID> users) {
        for (UUID u : users) active.remove(u, callId);
    }

    @Override public synchronized Optional<UUID> activeCall(UUID userId) { return Optional.ofNullable(active.get(userId)); }
    @Override public synchronized void touchPresence(UUID userId) { online.add(userId); }
    @Override public synchronized void clearPresence(UUID userId) { online.remove(userId); }
    @Override public synchronized boolean isOnline(UUID userId) { return online.contains(userId); }
    @Override public synchronized Set<UUID> recentPartners(UUID userId) { return Set.copyOf(recent.getOrDefault(userId, Set.of())); }

    @Override
    public synchronized void rememberPair(UUID a, UUID b) {
        recent.computeIfAbsent(a, k -> new HashSet<>()).add(b);
        recent.computeIfAbsent(b, k -> new HashSet<>()).add(a);
    }
}
