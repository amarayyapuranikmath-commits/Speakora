package com.englishspeaking.platform.matching;

import com.englishspeaking.platform.TestSupport;
import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.moderation.ModerationService;
import com.englishspeaking.platform.preferences.UserPreferences;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.EnglishLevel;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.topics.TopicService;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.redis.RedisConnectionFailureException;

import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Joining and matching after the round-trip reductions: the same behaviour, from fewer and concurrent reads. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MatchmakingRoundTripsTest {
    @Mock UserRepository users;
    @Mock UserProfileRepository profiles;
    @Mock UserPreferencesRepository preferences;
    @Mock TopicService topics;
    @Mock ModerationService moderation;
    @Mock CallService calls;
    @Mock ApplicationEventPublisher events;

    final TestSupport.MutableClock clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z"));
    final InMemoryMatchmakingStore store = new InMemoryMatchmakingStore();
    final List<UUID[]> createdCalls = new CopyOnWriteArrayList<>();
    MatchmakingService service;

    @BeforeEach
    void setUp() {
        service = new MatchmakingService(store, users, profiles, preferences, topics, moderation, calls, events, clock);
        when(calls.createMatchedCall(any(), any(), any(), any())).thenAnswer(i -> {
            createdCalls.add(new UUID[]{i.getArgument(1), i.getArgument(2)});
            return null;
        });
        when(calls.activeCallOf(any())).thenReturn(Optional.empty());
    }

    /** A signed-in person whose account, profile and preferences arrive in ONE combined read (the fast path). */
    private UUID person(EnglishLevel level) {
        User u = new User("u" + UUID.randomUUID() + "@x.com", "h", LocalDate.of(1990, 1, 1));
        u.setOnboardingCompleted(true);
        UserProfile p = new UserProfile(u.getId(), "User");
        p.setEnglishLevel(level);
        p.setInterests(List.of("travel"));
        UserPreferences prefs = new UserPreferences(u.getId());
        when(users.findAccountProfileAndPreferences(u.getId())).thenReturn(List.<Object[]>of(new Object[]{u, p, prefs}));
        store.touchPresence(u.getId());
        return u.getId();
    }

    @Test
    void theFastPathReadsAccountProfileAndPreferencesInOneQueryAndNothingElse() {
        UUID a = person(EnglishLevel.B2);
        assertThat(service.join(a, null)).isEmpty();
        verify(users, times(1)).findAccountProfileAndPreferences(a);
        verify(users, never()).findById(any());
        verify(profiles, never()).findById(any());
        verify(preferences, never()).findById(any());
        assertThat(store.candidates(10)).singleElement().satisfies(e -> assertThat(e.level()).isEqualTo(EnglishLevel.B2.ordinal() + 1));
    }

    @Test
    void whenTheCombinedReadFindsNothingTheStepByStepPathStillReportsExactlyWhatIsMissing() {
        UUID id = UUID.randomUUID();
        when(users.findAccountProfileAndPreferences(id)).thenReturn(List.of());
        when(users.findById(id)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.join(id, null)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("UNAUTHENTICATED"));

        User u = new User("x@x.com", "h", LocalDate.of(1990, 1, 1));
        u.setOnboardingCompleted(true);
        when(users.findAccountProfileAndPreferences(u.getId())).thenReturn(List.of());
        when(users.findById(u.getId())).thenReturn(Optional.of(u));
        when(profiles.findById(u.getId())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.join(u.getId(), null)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("ONBOARDING_REQUIRED"));
    }

    @Test
    void anActiveCallStillBlocksJoiningAndAStaleRedisMarkerIsStillCleared() {
        UUID busy = person(EnglishLevel.B1);
        when(calls.activeCallOf(busy)).thenReturn(Optional.of(mock(com.englishspeaking.platform.calling.CallSession.class)));
        assertThatThrownBy(() -> service.join(busy, null)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("ALREADY_IN_CALL"));

        UUID stale = person(EnglishLevel.B1);
        UUID oldCall = UUID.randomUUID();
        store.claimDirect(stale, UUID.randomUUID(), oldCall); // a marker with no active call behind it
        assertThat(store.activeCall(stale)).isPresent();
        service.join(stale, null);
        assertThat(store.activeCall(stale)).isEmpty();
    }

    @Test
    void joiningTwiceKeepsOneQueueEntryAndMakesOneMatch() {
        UUID a = person(EnglishLevel.B1), b = person(EnglishLevel.B1);
        service.join(a, null);
        service.join(a, null); // a duplicate request (double tap, reconnect)
        assertThat(store.candidates(10)).hasSize(1);
        assertThat(service.join(b, null)).isPresent();
        assertThat(createdCalls).hasSize(1);
        assertThat(store.candidates(10)).isEmpty();
    }

    @Test
    void aCancelledSearchIsNeverMatched() {
        UUID a = person(EnglishLevel.B1), b = person(EnglishLevel.B1);
        service.join(a, null);
        service.leave(a);
        assertThat(store.contains(a)).isFalse();
        assertThat(service.join(b, null)).isEmpty();
        assertThat(createdCalls).isEmpty();
    }

    @Test
    void manyPeopleJoiningAtOnceAreMatchedInPairsAndNobodyIsInTwoCalls() throws Exception {
        List<UUID> people = new ArrayList<>();
        for (int i = 0; i < 40; i++) people.add(person(EnglishLevel.B1));
        ExecutorService pool = Executors.newFixedThreadPool(16);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<?>> all = new ArrayList<>();
        for (UUID id : people) all.add(pool.submit(() -> { go.await(); service.join(id, null); return null; }));
        go.countDown();
        for (Future<?> f : all) f.get(20, TimeUnit.SECONDS);
        pool.shutdown();
        for (int i = 0; i < 3; i++) service.sweep(); // anyone left over is paired by the next passes

        Set<UUID> seen = new HashSet<>();
        for (UUID[] call : createdCalls) {
            assertThat(seen.add(call[0])).as("person in two calls").isTrue();
            assertThat(seen.add(call[1])).as("person in two calls").isTrue();
        }
        assertThat(createdCalls).hasSize(20);
        assertThat(store.candidates(100)).isEmpty();
    }

    @Test
    void aSweepFromOneSnapshotPairsEachPersonOnceAndLeavesTheOddOneWaiting() {
        UUID a = person(EnglishLevel.B1), b = person(EnglishLevel.B1), c = person(EnglishLevel.B1);
        for (UUID id : List.of(a, b, c)) store.enqueue(new QueueEntry(id, 3, Set.of("travel"), null, true, clock.millis()));
        service.sweep();
        assertThat(createdCalls).hasSize(1);
        assertThat(store.candidates(10)).hasSize(1); // the third person keeps waiting; nobody was offered twice
    }

    @Test
    void anOfflineWaiterIsDroppedFromTheQueueNotMatched() {
        UUID a = person(EnglishLevel.B1), gone = person(EnglishLevel.B1);
        store.enqueue(new QueueEntry(gone, 3, Set.of("travel"), null, true, clock.millis() - 1000));
        store.clearPresence(gone);
        assertThat(service.join(a, null)).isEmpty();
        assertThat(store.contains(gone)).isFalse();
        assertThat(createdCalls).isEmpty();
    }

    @Test
    void peopleWhoBlockedEachOtherAreNotMatchedAndTheBlockListIsReadOnce() {
        UUID a = person(EnglishLevel.B1), b = person(EnglishLevel.B1);
        when(moderation.excludedPartners(a)).thenReturn(Set.of(b));
        when(moderation.excludedPartners(b)).thenReturn(Set.of(a));
        service.join(a, null);
        assertThat(service.join(b, null)).isEmpty();
        assertThat(createdCalls).isEmpty();
        verify(moderation, times(1)).excludedPartners(a);
    }

    @Test
    void aRedisFailureWhileMatchingIsReportedAsTheSameRedisFailureNotAWrapper() {
        UUID a = person(EnglishLevel.B1);
        MatchmakingStore failing = new InMemoryMatchmakingStore() {
            @Override public MatchContext matchContext(UUID me, int limit) { throw new RedisConnectionFailureException("down"); }
        };
        MatchmakingService broken = new MatchmakingService(failing, users, profiles, preferences, topics, moderation, calls, events, clock);
        assertThatThrownBy(() -> broken.join(a, null)).isInstanceOf(RedisConnectionFailureException.class);
    }

    @Test
    void aDatabaseFailureWhileCheckingBlocksIsReportedAsTheSameFailure() {
        UUID a = person(EnglishLevel.B1);
        when(moderation.excludedPartners(a)).thenThrow(new org.springframework.dao.QueryTimeoutException("slow"));
        assertThatThrownBy(() -> service.join(a, null)).isInstanceOf(org.springframework.dao.QueryTimeoutException.class);
    }
}
