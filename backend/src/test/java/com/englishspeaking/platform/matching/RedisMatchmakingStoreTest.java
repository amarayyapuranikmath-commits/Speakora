package com.englishspeaking.platform.matching;

import com.englishspeaking.platform.LocalRedis;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/** The Redis store's batched reads and one-call writes, against a real Redis (skipped when none is reachable). */
class RedisMatchmakingStoreTest {
    StringRedisTemplate redis;
    RedisMatchmakingStore store;

    @BeforeEach
    void setUp() {
        redis = LocalRedis.template();
        store = new RedisMatchmakingStore(redis, new ObjectMapper());
    }

    private QueueEntry entry(UUID id, long at) { return new QueueEntry(id, 3, Set.of("travel"), null, true, at); }

    @Test
    void enqueueRemoveAndContainsWorkAndARejoinOverwritesTheEarlierEntry() {
        UUID a = UUID.randomUUID();
        store.enqueue(entry(a, 1000));
        store.enqueue(entry(a, 2000)); // the same person joins again
        assertThat(store.contains(a)).isTrue();
        assertThat(store.candidates(10)).singleElement().satisfies(e -> assertThat(e.enqueuedAtMillis()).isEqualTo(2000));
        assertThat(redis.opsForZSet().zCard("mm:queue")).isEqualTo(1);
        assertThat(store.remove(a)).isTrue();
        assertThat(store.remove(a)).isFalse();
        assertThat(redis.hasKey("mm:entry:" + a)).isFalse(); // the entry key went with the queue member
    }

    @Test
    void anEntryHasAnExpiry() {
        UUID a = UUID.randomUUID();
        store.enqueue(entry(a, 1));
        assertThat(redis.getExpire("mm:entry:" + a, TimeUnit.SECONDS)).isBetween(1L, RedisMatchmakingStore.ENTRY_TTL.toSeconds());
    }

    @Test
    void matchContextSaysNotQueuedForSomeoneWhoIsNotWaiting() {
        MatchmakingStore.MatchContext ctx = store.matchContext(UUID.randomUUID(), 50);
        assertThat(ctx.queued()).isFalse();
        assertThat(ctx.candidates()).isEmpty();
    }

    @Test
    void matchContextReturnsTheQueueInOrderWithRecentPartnersAndWhoIsOnline() {
        UUID me = UUID.randomUUID(), early = UUID.randomUUID(), late = UUID.randomUUID(), away = UUID.randomUUID(), recent = UUID.randomUUID();
        store.enqueue(entry(early, 100)); store.enqueue(entry(me, 200)); store.enqueue(entry(away, 250)); store.enqueue(entry(late, 300));
        store.touchPresence(early); store.touchPresence(me); store.touchPresence(late); // the person called "away" has no presence
        store.rememberPair(me, recent);

        MatchmakingStore.MatchContext ctx = store.matchContext(me, 50);
        assertThat(ctx.queued()).isTrue();
        assertThat(ctx.candidates()).extracting(QueueEntry::userId).containsExactly(early, me, away, late);
        assertThat(ctx.online()).containsExactlyInAnyOrder(early, me, late);
        assertThat(ctx.recentPartners()).containsExactly(recent);
    }

    @Test
    void matchContextRespectsTheCandidateLimit() {
        UUID me = UUID.randomUUID();
        for (int i = 0; i < 5; i++) store.enqueue(entry(UUID.randomUUID(), 100 + i));
        store.enqueue(entry(me, 1000));
        assertThat(store.matchContext(me, 3).candidates()).hasSize(3);
    }

    @Test
    void anExpiredEntryOrUnreadableOneIsDroppedFromTheQueueInsteadOfBreakingTheRead() {
        UUID me = UUID.randomUUID(), expired = UUID.randomUUID(), garbage = UUID.randomUUID();
        store.enqueue(entry(me, 100)); store.enqueue(entry(expired, 200)); store.enqueue(entry(garbage, 300));
        redis.delete("mm:entry:" + expired); // its entry expired but the queue member is still there
        redis.opsForValue().set("mm:entry:" + garbage, "{not json");
        MatchmakingStore.MatchContext ctx = store.matchContext(me, 50);
        assertThat(ctx.candidates()).extracting(QueueEntry::userId).containsExactly(me);
        assertThat(store.contains(expired)).isFalse();
        assertThat(store.contains(garbage)).isFalse();
    }

    @Test
    void presenceForManyPeopleIsOneAnswer() {
        UUID on = UUID.randomUUID(), off = UUID.randomUUID();
        store.touchPresence(on);
        assertThat(store.online(List.of(on, off))).containsExactly(on);
        assertThat(store.online(List.of())).isEmpty();
    }

    @Test
    void twoMatchersRacingForTheSamePairProduceExactlyOneClaim() throws Exception {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        store.enqueue(entry(a, 1)); store.enqueue(entry(b, 2));
        ExecutorService pool = Executors.newFixedThreadPool(8);
        AtomicInteger wins = new AtomicInteger();
        CountDownLatch go = new CountDownLatch(1);
        List<Future<?>> all = new ArrayList<>();
        for (int i = 0; i < 8; i++) all.add(pool.submit(() -> { go.await(); if (store.tryClaim(a, b, UUID.randomUUID())) wins.incrementAndGet(); return null; }));
        go.countDown();
        for (Future<?> f : all) f.get(20, TimeUnit.SECONDS);
        pool.shutdown();
        assertThat(wins.get()).isEqualTo(1);
        assertThat(store.activeCall(a)).isPresent().isEqualTo(store.activeCall(b));
        assertThat(store.contains(a)).isFalse();
    }

    @Test
    void releasingACallClearsBothMarkersOnlyWhenTheyStillPointAtThatCall() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID(), call = UUID.randomUUID(), other = UUID.randomUUID();
        store.claimDirect(a, b, call);
        store.releaseCall(other, List.of(a, b)); // a different call id: nothing is cleared
        assertThat(store.activeCall(a)).contains(call);
        assertThat(store.activeCall(b)).contains(call);
        store.releaseCall(call, List.of(a, b));
        assertThat(store.activeCall(a)).isEmpty();
        assertThat(store.activeCall(b)).isEmpty();
    }

    @Test
    void claimingDirectlyRemovesBothQueueEntries() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        store.enqueue(entry(a, 1)); store.enqueue(entry(b, 2));
        assertThat(store.claimDirect(a, b, UUID.randomUUID())).isTrue();
        assertThat(redis.hasKey("mm:entry:" + a)).isFalse();
        assertThat(redis.hasKey("mm:entry:" + b)).isFalse();
        assertThat(store.claimDirect(a, UUID.randomUUID(), UUID.randomUUID())).isFalse(); // a is already in a call
    }

    @Test
    void rememberingAPairIsMutualAndExpires() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        store.rememberPair(a, b);
        assertThat(store.recentPartners(a)).containsExactly(b);
        assertThat(store.recentPartners(b)).containsExactly(a);
        assertThat(redis.getExpire("mm:recent:" + a, TimeUnit.SECONDS)).isPositive();
        assertThat(redis.getExpire("mm:recent:" + b, TimeUnit.SECONDS)).isPositive();
    }

    private long openConnections() {
        try (var c = redis.getRequiredConnectionFactory().getConnection()) {
            var list = c.serverCommands().getClientList();
            return list == null ? 0 : list.size();
        }
    }

    @Test
    void noOperationOpensANewRedisConnection() {
        // A pipeline on Spring's Lettuce client opens (and tears down) a dedicated connection each time: against a TLS Redis that is several extra round
        // trips per call, far worse than the commands it saves. Every operation must stay on the shared connection.
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        store.enqueue(entry(a, 1)); store.touchPresence(a);
        long before = openConnections();
        for (int i = 0; i < 25; i++) {
            store.matchContext(a, 50);
            store.rememberPair(a, b);
            store.releaseCall(UUID.randomUUID(), List.of(a, b));
            store.online(List.of(a, b));
            store.enqueue(entry(a, 1 + i));
            store.remove(b);
        }
        assertThat(openConnections()).isEqualTo(before);
    }

    private void flushScriptCache() {
        redis.execute((org.springframework.data.redis.core.RedisCallback<Object>) c -> { c.scriptingCommands().scriptFlush(); return null; });
    }

    @Test
    void everyOperationStillWorksWhenTheServerHasForgottenItsCachedScripts() {
        // A restarted or failed-over Redis (and some hosted ones) answers EVALSHA with NOSCRIPT until a script is sent again; the client must fall back to EVAL.
        UUID me = UUID.randomUUID(), other = UUID.randomUUID(), call = UUID.randomUUID();
        flushScriptCache();
        store.enqueue(entry(me, 1)); flushScriptCache();
        store.enqueue(entry(other, 2)); store.touchPresence(me); store.touchPresence(other); flushScriptCache();
        MatchmakingStore.MatchContext ctx = store.matchContext(me, 50); flushScriptCache();
        assertThat(ctx.queued()).isTrue();
        assertThat(ctx.candidates()).extracting(QueueEntry::userId).containsExactly(me, other);
        assertThat(ctx.online()).containsExactlyInAnyOrder(me, other);
        store.rememberPair(me, other); flushScriptCache();
        assertThat(store.tryClaim(me, other, call)).isTrue(); flushScriptCache();
        store.releaseCall(call, List.of(me, other)); flushScriptCache();
        assertThat(store.activeCall(me)).isEmpty();
        store.enqueue(entry(me, 3)); flushScriptCache();
        assertThat(store.remove(me)).isTrue();
    }

    @Test
    void missingEntriesAndPresenceComeBackAsEmptyMarkersNotAsNilInsideAnArray() {
        UUID me = UUID.randomUUID(), noPresence = UUID.randomUUID();
        store.enqueue(entry(me, 1)); store.enqueue(entry(noPresence, 2));
        store.touchPresence(me);
        MatchmakingStore.MatchContext ctx = store.matchContext(me, 50);
        assertThat(ctx.candidates()).extracting(QueueEntry::userId).containsExactly(me, noPresence);
        assertThat(ctx.online()).containsExactly(me); // the second person's missing presence is read as "offline", not as an error
    }
}
