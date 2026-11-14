package com.englishspeaking.platform.matching;

import com.englishspeaking.platform.auth.AuthService;
import com.englishspeaking.platform.calling.CallEvents;
import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.calling.CallStatus;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.moderation.ModerationService;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.topics.Topic;
import com.englishspeaking.platform.topics.TopicService;
import com.englishspeaking.platform.user.AccountService;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import com.englishspeaking.platform.user.UserStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Clock;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

@Service
public class MatchmakingService {
    private static final Logger log = LoggerFactory.getLogger(MatchmakingService.class);

    static final int CANDIDATE_LIMIT = 50;
    static final long RELAX_AFTER_MILLIS = 30_000;
    /** Searching only ends by the user cancelling, by being offline (presence), or after this very long wait. */
    static final long QUEUE_TIMEOUT_MILLIS = 10 * 60_000;
    /**
     * People who just talked are a last resort, not a ban: anyone else compatible is always preferred, but if nobody else shows up
     * the pair may be matched again once one of them has waited this long (otherwise two users could never talk twice).
     */
    static final long RECENT_REMATCH_AFTER_MILLIS = 5_000;
    static final double RECENT_PENALTY = 1_000;
    static final int MAX_LEVEL_GAP = 2;

    public record QueueTimedOut(UUID userId) {}

    private final MatchmakingStore store;
    private final UserRepository users;
    private final UserProfileRepository profiles;
    private final UserPreferencesRepository preferences;
    private final TopicService topics;
    private final ModerationService moderation;
    private final CallService calls;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public MatchmakingService(MatchmakingStore store, UserRepository users, UserProfileRepository profiles,
                              UserPreferencesRepository preferences, TopicService topics, ModerationService moderation,
                              CallService calls, ApplicationEventPublisher events, Clock clock) {
        this.store = store;
        this.users = users;
        this.profiles = profiles;
        this.preferences = preferences;
        this.topics = topics;
        this.moderation = moderation;
        this.calls = calls;
        this.events = events;
        this.clock = clock;
    }

    /** Independent reads (database and Redis are both remote) run at the same time instead of one after the other. */
    private static final ExecutorService IO = Executors.newVirtualThreadPerTaskExecutor();

    private static <T> CompletableFuture<T> async(Supplier<T> work) { return CompletableFuture.supplyAsync(work, IO); }

    /** Waits for a result and rethrows the original unchecked exception (an ApiException, a Redis failure...), not a wrapper. */
    private static <T> T await(CompletableFuture<T> future) {
        try {
            return future.join();
        } catch (CompletionException e) {
            if (e.getCause() instanceof RuntimeException re) throw re;
            throw e;
        }
    }

    /** Puts the user in the queue and immediately tries to pair them. Returns the call id if matched right away. */
    public Optional<UUID> join(UUID userId, String topicSlug) {
        // The account, profile and preferences come in one query. If any of them is missing the step-by-step path below reports which one.
        List<Object[]> row = users.findAccountProfileAndPreferences(userId);
        User user;
        UserProfile profile = null;
        com.englishspeaking.platform.preferences.UserPreferences prefs = null;
        if (row != null && !row.isEmpty()) {
            user = (User) row.get(0)[0];
            profile = (UserProfile) row.get(0)[1];
            prefs = (com.englishspeaking.platform.preferences.UserPreferences) row.get(0)[2];
        } else {
            user = users.findById(userId).orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again."));
        }
        AuthService.requireActive(user);
        if (user.getStatus() != UserStatus.ACTIVE) throw ApiException.forbidden("ACCOUNT_INACTIVE", "This account cannot start calls.");
        if (!user.isOnboardingCompleted()) throw ApiException.conflict("ONBOARDING_REQUIRED", "Complete your profile before finding a partner.");
        // Three independent questions, asked together: is there an active call (PostgreSQL), is there an in-call marker (Redis), is the topic valid.
        var activeCall = async(() -> calls.activeCallOf(userId).isPresent());
        var marker = async(() -> store.activeCall(userId));
        var topic = (topicSlug != null && !topicSlug.isBlank()) ? async(() -> topics.findActive(topicSlug).map(Topic::getSlug)) : null;
        if (await(activeCall)) {
            throw ApiException.conflict("ALREADY_IN_CALL", "You are already in a call.");
        }
        // PostgreSQL is the source of truth: a Redis "in call" marker with no active call behind it is stale
        // (e.g. the server died between claiming and saving) and must not lock the user out.
        await(marker).ifPresent(staleCallId -> store.releaseCall(staleCallId, List.of(userId)));
        String slug = null;
        if (topic != null) {
            slug = await(topic).orElseThrow(() -> ApiException.badRequest("INVALID_TOPIC", "That topic is not available."));
        }
        if (profile == null) {
            profile = profiles.findById(userId).orElseThrow(() -> ApiException.conflict("ONBOARDING_REQUIRED", "Complete your profile first."));
            prefs = preferences.findById(userId).orElse(null);
        }
        boolean similarOnly = prefs == null || prefs.isMatchSimilarLevel();
        int level = profile.getEnglishLevel() == null ? 0 : profile.getEnglishLevel().ordinal() + 1;
        QueueEntry entry = new QueueEntry(userId, level, new HashSet<>(profile.getInterests()), slug, similarOnly, clock.millis());
        store.enqueue(entry); // joining again simply overwrites the person's earlier entry and place (same entry key, same queue member)
        return tryMatch(entry);
    }

    public void leave(UUID userId) { store.remove(userId); }

    /** Looks for the best compatible waiting partner and atomically claims them. */
    Optional<UUID> tryMatch(QueueEntry me) {
        // The database question (who must never be matched) and the Redis questions (queue, recent partners, presence) are independent: ask together.
        var excludedF = async(() -> new HashSet<>(moderation.excludedPartners(me.userId())));
        MatchmakingStore.MatchContext ctx = store.matchContext(me.userId(), CANDIDATE_LIMIT);
        if (!ctx.queued()) return Optional.empty();
        return attempt(me, await(excludedF), ctx.recentPartners(), ctx.candidates(), ctx.online(), null);
    }

    /**
     * One match attempt for {@code me} from what is already known. {@code taken}, when given, collects people matched during this pass so that a
     * sweep working from one snapshot of the queue never offers somebody who was just matched.
     */
    private Optional<UUID> attempt(QueueEntry me, Set<UUID> excluded, Set<UUID> recent, List<QueueEntry> candidates, Set<UUID> online, Set<UUID> taken) {
        long now = clock.millis();

        List<Scored> ranked = new ArrayList<>();
        for (QueueEntry other : candidates) {
            if (other.userId().equals(me.userId()) || excluded.contains(other.userId())) continue;
            if (taken != null && taken.contains(other.userId())) continue;
            if (!online.contains(other.userId())) { store.remove(other.userId()); continue; }
            boolean justTalked = recent.contains(other.userId());
            long waited = Math.max(now - me.enqueuedAtMillis(), now - other.enqueuedAtMillis());
            if (justTalked && waited < RECENT_REMATCH_AFTER_MILLIS) continue; // give someone new a chance to arrive first
            score(me, other, now).ifPresent(s -> ranked.add(new Scored(other, justTalked ? s - RECENT_PENALTY : s)));
        }
        ranked.sort(Comparator.comparingDouble(Scored::score).reversed());

        for (Scored candidate : ranked) {
            QueueEntry other = candidate.entry();
            QueueEntry initiator = me.enqueuedAtMillis() <= other.enqueuedAtMillis() ? me : other;
            QueueEntry responder = initiator == me ? other : me;
            UUID callId = UUID.randomUUID();
            if (!store.tryClaim(initiator.userId(), responder.userId(), callId)) {
                if (!store.contains(me.userId())) return Optional.empty(); // someone else matched me first
                continue; // candidate was taken: try the next one
            }
            try {
                calls.createMatchedCall(callId, initiator.userId(), responder.userId(), sharedTopic(me, other));
                store.rememberPair(me.userId(), other.userId());
                if (taken != null) { taken.add(me.userId()); taken.add(other.userId()); }
                return Optional.of(callId);
            } catch (RuntimeException e) {
                log.error("Failed to create call for match {} <-> {}; returning both to the queue", me.userId(), other.userId(), e);
                store.releaseCall(callId, List.of(me.userId(), other.userId()));
                store.enqueue(me);
                store.enqueue(other);
                return Optional.empty();
            }
        }
        return Optional.empty();
    }

    /** Periodic pass: expire stale waiters and retry matching so relaxed rules apply as waiting time grows. */
    public void sweep() {
        long now = clock.millis();
        // One snapshot of the queue and of who is online for the whole pass (before: the queue was read again, and presence asked one person at a
        // time, for every waiting person). A claim is atomic and re-checks both people, so a snapshot that has become stale only costs a failed claim.
        List<QueueEntry> entries = store.candidates(200);
        Set<UUID> online = store.online(entries.stream().map(QueueEntry::userId).toList());
        List<QueueEntry> window = entries.subList(0, Math.min(CANDIDATE_LIMIT, entries.size()));
        Set<UUID> taken = new HashSet<>();
        for (QueueEntry entry : entries) {
            if (taken.contains(entry.userId())) continue;
            if (now - entry.enqueuedAtMillis() > QUEUE_TIMEOUT_MILLIS || !online.contains(entry.userId())) {
                if (store.remove(entry.userId())) events.publishEvent(new QueueTimedOut(entry.userId()));
            } else {
                try {
                    var excludedF = async(() -> new HashSet<>(moderation.excludedPartners(entry.userId())));
                    Set<UUID> recent = store.recentPartners(entry.userId());
                    attempt(entry, await(excludedF), recent, window, online, taken);
                } catch (RuntimeException e) {
                    log.warn("Match attempt failed for {}: {}", entry.userId(), e.getMessage());
                }
            }
        }
    }

    /**
     * Redis is only temporary state. The in-call markers are released only AFTER the call row is committed as finished, so
     * nobody can be re-matched while PostgreSQL still says they are in a call. A Redis failure must never propagate. A marker left behind is
     * cleared by the stale-marker check in {@link #join}, and queue entries expire on their own.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    void onCallStateChanged(CallEvents.StateChanged event) {
        if (!event.status().isTerminal()) return;
        try {
            store.releaseCall(event.callId(), event.participantIds());
        } catch (RuntimeException e) {
            log.warn("Could not release in-call markers for call {} (Redis unavailable?): {}", event.callId(), e.getMessage());
        }
    }

    @EventListener
    void onUserSuspended(com.englishspeaking.platform.moderation.UserSuspendedEvent event) {
        try {
            store.remove(event.userId());
        } catch (RuntimeException e) {
            log.warn("Could not remove suspended user {} from the queue (Redis unavailable?): {}", event.userId(), e.getMessage());
        }
    }

    @EventListener
    void onAccountDeleted(AccountService.AccountDeletedEvent event) {
        try {
            store.remove(event.userId());
        } catch (RuntimeException e) {
            log.warn("Could not remove deleted user {} from the queue (Redis unavailable?): {}", event.userId(), e.getMessage());
        }
    }

    private Optional<Double> score(QueueEntry me, QueueEntry other, long now) {
        int gap = (me.level() > 0 && other.level() > 0) ? Math.abs(me.level() - other.level()) : 0;
        long waited = Math.max(now - me.enqueuedAtMillis(), now - other.enqueuedAtMillis());
        boolean strict = (me.similarLevelOnly() || other.similarLevelOnly()) && waited < RELAX_AFTER_MILLIS;
        if (strict && gap > MAX_LEVEL_GAP) return Optional.empty();
        Set<String> shared = new HashSet<>(me.interests());
        shared.retainAll(other.interests());
        boolean sameTopic = me.topicSlug() != null && me.topicSlug().equals(other.topicSlug());
        return Optional.of(100.0 - gap * 10 + shared.size() * 5 + (sameTopic ? 20 : 0) + Math.min(waited / 1000.0, 60) * 0.2);
    }

    private UUID sharedTopic(QueueEntry a, QueueEntry b) {
        String slug = a.topicSlug() != null && a.topicSlug().equals(b.topicSlug()) ? a.topicSlug() : null;
        return slug == null ? null : topics.findActive(slug).map(Topic::getId).orElse(null);
    }

    private record Scored(QueueEntry entry, double score) {}
}
