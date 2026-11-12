package com.englishspeaking.platform.matching;

import com.englishspeaking.platform.TestSupport;
import com.englishspeaking.platform.calling.CallEvents;
import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.calling.CallStatus;
import com.englishspeaking.platform.calling.EndReason;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.moderation.ModerationService;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.EnglishLevel;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.topics.TopicService;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import com.englishspeaking.platform.user.UserStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.context.ApplicationEventPublisher;

import java.lang.reflect.Field;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MatchmakingServiceTest {
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
    }

    private UUID user(EnglishLevel level, String... interests) {
        User u = new User("u" + UUID.randomUUID() + "@x.com", "h", LocalDate.of(1990, 1, 1));
        u.setOnboardingCompleted(true);
        UserProfile p = new UserProfile(u.getId(), "User");
        p.setEnglishLevel(level);
        p.setInterests(List.of(interests));
        when(users.findById(u.getId())).thenReturn(Optional.of(u));
        when(profiles.findById(u.getId())).thenReturn(Optional.of(p));
        store.touchPresence(u.getId());
        return u.getId();
    }

    @Test
    void twoWaitingUsersAreMatchedIntoOneCall() {
        UUID a = user(EnglishLevel.B1), b = user(EnglishLevel.B1);
        assertThat(service.join(a, null)).isEmpty();
        assertThat(service.join(b, null)).isPresent();

        assertThat(createdCalls).hasSize(1);
        assertThat(Set.of(createdCalls.get(0))).containsExactlyInAnyOrder(a, b);
        assertThat(store.contains(a)).isFalse();
        assertThat(store.contains(b)).isFalse();
        assertThat(store.activeCall(a)).isPresent().isEqualTo(store.activeCall(b));
    }

    @Test
    void lonelyUserStaysQueuedAndIsNeverMatchedWithThemselves() {
        UUID a = user(EnglishLevel.B1);
        assertThat(service.join(a, null)).isEmpty();
        service.sweep();
        assertThat(createdCalls).isEmpty();
        assertThat(store.contains(a)).isTrue();
    }

    @Test
    void blockedUsersAreNeverMatched() {
        UUID a = user(EnglishLevel.B1), b = user(EnglishLevel.B1);
        when(moderation.excludedPartners(a)).thenReturn(Set.of(b));
        when(moderation.excludedPartners(b)).thenReturn(Set.of(a));
        service.join(a, null);
        service.join(b, null);
        service.sweep();
        assertThat(createdCalls).isEmpty();
    }

    @Test
    void recentPartnersAreNotImmediatelyRematched() {
        UUID a = user(EnglishLevel.B1), b = user(EnglishLevel.B1);
        store.rememberPair(a, b);
        service.join(a, null);
        service.join(b, null);
        assertThat(createdCalls).isEmpty();
        clock.advance(Duration.ofSeconds(3));
        service.sweep();
        assertThat(createdCalls).as("still inside the grace window for someone new to arrive").isEmpty();
    }

    @Test
    void theOnlyTwoUsersCanTalkAgainAfterAShortWait() {
        // Regression: a hard 10-minute ban meant two testers who finished a call could never be matched again.
        UUID a = user(EnglishLevel.B1), b = user(EnglishLevel.B1);
        store.rememberPair(a, b);
        service.join(a, null);
        service.join(b, null);
        clock.advance(Duration.ofSeconds(6));
        store.touchPresence(a);
        store.touchPresence(b);
        service.sweep();
        assertThat(createdCalls).hasSize(1);
        assertThat(Set.of(createdCalls.get(0))).containsExactlyInAnyOrder(a, b);
    }

    @Test
    void aNewcomerIsAlwaysPreferredOverSomeoneYouJustTalkedTo() {
        UUID a = user(EnglishLevel.B1), recent = user(EnglishLevel.B1), fresh = user(EnglishLevel.B1);
        store.rememberPair(a, recent);
        when(moderation.excludedPartners(fresh)).thenReturn(Set.of(recent)); // keep the two other waiters apart
        when(moderation.excludedPartners(recent)).thenReturn(Set.of(fresh));
        service.join(recent, null);
        clock.advance(Duration.ofSeconds(8)); // the recent partner has waited long enough to be eligible
        store.touchPresence(recent);
        service.join(fresh, null);
        assertThat(createdCalls).isEmpty();

        service.join(a, null);

        assertThat(createdCalls).hasSize(1);
        assertThat(Set.of(createdCalls.get(0))).containsExactlyInAnyOrder(a, fresh);
    }

    @Test
    void searchingKeepsGoingForMinutesInsteadOfGivingUpAfterNinetySeconds() {
        UUID a = user(EnglishLevel.B1);
        service.join(a, null);
        clock.advance(Duration.ofMinutes(5));
        store.touchPresence(a);
        service.sweep();
        assertThat(store.contains(a)).isTrue();
        verify(events, never()).publishEvent(any(MatchmakingService.QueueTimedOut.class));
    }

    @Test
    void largeLevelGapWaitsThenRelaxes() {
        UUID a = user(EnglishLevel.A1), b = user(EnglishLevel.C2);
        service.join(a, null);
        service.join(b, null);
        service.sweep();
        assertThat(createdCalls).isEmpty();

        clock.advance(Duration.ofSeconds(31));
        service.sweep();
        assertThat(createdCalls).hasSize(1);
    }

    @Test
    void prefersSimilarLevelAndSharedInterests() {
        UUID acceptable = user(EnglishLevel.B1, "travel");
        UUID best = user(EnglishLevel.A2, "technology");
        when(moderation.excludedPartners(acceptable)).thenReturn(Set.of(best)); // keep the two waiters apart
        when(moderation.excludedPartners(best)).thenReturn(Set.of(acceptable));
        UUID me = user(EnglishLevel.A2, "technology");
        service.join(acceptable, null);
        service.join(best, null);
        assertThat(createdCalls).isEmpty();
        service.join(me, null);
        assertThat(Set.of(createdCalls.get(0))).containsExactlyInAnyOrder(me, best);
    }

    private void markInCallInRedis(UUID a, UUID b, UUID callId) {
        store.enqueue(new QueueEntry(a, 3, Set.of(), null, true, 0));
        store.enqueue(new QueueEntry(b, 3, Set.of(), null, true, 0));
        assertThat(store.tryClaim(a, b, callId)).isTrue();
    }

    @Test
    void userWithAnActiveCallInTheDatabaseCannotQueue() {
        UUID a = user(EnglishLevel.B1);
        when(calls.activeCallOf(a)).thenReturn(Optional.of(new com.englishspeaking.platform.calling.CallSession(UUID.randomUUID(), null, clock.instant())));
        assertThatThrownBy(() -> service.join(a, null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("ALREADY_IN_CALL"));
        assertThat(store.contains(a)).isFalse();
    }

    @Test
    void staleRedisInCallMarkerDoesNotLockTheUserOut() {
        UUID a = user(EnglishLevel.B1), b = user(EnglishLevel.B1);
        markInCallInRedis(a, b, UUID.randomUUID()); // Redis says "in a call"; the database has no such call
        assertThat(store.activeCall(a)).isPresent();

        service.join(a, null);

        assertThat(store.activeCall(a)).isEmpty();
        assertThat(store.contains(a)).isTrue();
    }

    @Test
    void usersMustFinishOnboardingAndBeActive() {
        User u = new User("n@x.com", "h", LocalDate.of(1990, 1, 1));
        when(users.findById(u.getId())).thenReturn(Optional.of(u));
        assertThatThrownBy(() -> service.join(u.getId(), null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("ONBOARDING_REQUIRED"));
        u.setStatus(UserStatus.SUSPENDED);
        assertThatThrownBy(() -> service.join(u.getId(), null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("ACCOUNT_SUSPENDED"));
    }

    @Test
    void cancelRemovesUserFromQueue() {
        UUID a = user(EnglishLevel.B1);
        service.join(a, null);
        service.leave(a);
        assertThat(store.contains(a)).isFalse();
    }

    @Test
    void waitersTimeOutAndAreNotified() {
        UUID a = user(EnglishLevel.B1);
        service.join(a, null);
        clock.advance(Duration.ofMinutes(11));
        store.touchPresence(a);
        service.sweep();
        assertThat(store.contains(a)).isFalse();
        verify(events).publishEvent(new MatchmakingService.QueueTimedOut(a));
    }

    @Test
    void waitersWhoWentOfflineAreDropped() {
        UUID a = user(EnglishLevel.B1), b = user(EnglishLevel.B1);
        service.join(a, null);
        store.clearPresence(a);
        service.join(b, null);
        assertThat(createdCalls).isEmpty();
        assertThat(store.contains(a)).isFalse();
    }

    @Test
    void failedCallCreationReturnsBothUsersToTheQueue() {
        UUID a = user(EnglishLevel.B1), b = user(EnglishLevel.B1);
        when(calls.createMatchedCall(any(), any(), any(), any())).thenThrow(new IllegalStateException("db down"));
        service.join(a, null);
        assertThat(service.join(b, null)).isEmpty();
        assertThat(store.contains(a)).isTrue();
        assertThat(store.contains(b)).isTrue();
        assertThat(store.activeCall(a)).isEmpty();
    }

    @Test
    void endedCallReleasesTheActiveMarkers() {
        UUID a = user(EnglishLevel.B1), b = user(EnglishLevel.B1);
        service.join(a, null);
        UUID callId = service.join(b, null).orElseThrow();
        service.onCallStateChanged(new CallEvents.StateChanged(callId, CallStatus.COMPLETED, EndReason.ENDED, a, 10, List.of(a, b)));
        assertThat(store.activeCall(a)).isEmpty();
        assertThat(store.activeCall(b)).isEmpty();
    }

    /** Many users join at once: nobody may end up in two calls, and everyone must end up matched. */
    @Test
    void concurrentJoinsNeverDoubleBookAnyone() throws Exception {
        int n = 60;
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < n; i++) ids.add(user(EnglishLevel.B1, "travel"));

        ExecutorService pool = Executors.newFixedThreadPool(16);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();
        for (UUID id : ids) {
            futures.add(pool.submit(() -> {
                start.await();
                service.join(id, null);
                return null;
            }));
        }
        start.countDown();
        for (Future<?> f : futures) f.get(10, TimeUnit.SECONDS);
        pool.shutdown();
        for (int i = 0; i < 5; i++) service.sweep();

        Map<UUID, Integer> appearances = new HashMap<>();
        for (UUID[] pair : createdCalls) {
            assertThat(pair[0]).isNotEqualTo(pair[1]);
            for (UUID u : pair) appearances.merge(u, 1, Integer::sum);
        }
        assertThat(appearances.values()).allMatch(c -> c == 1);
        assertThat(appearances).hasSize(n);
        assertThat(createdCalls).hasSize(n / 2);
    }

    @Test
    void skipRejoinsWithoutRematchingThePreviousPartner() {
        UUID a = user(EnglishLevel.B1), b = user(EnglishLevel.B1), c = user(EnglishLevel.B1);
        service.join(a, null);
        UUID first = service.join(b, null).orElseThrow();
        service.onCallStateChanged(new CallEvents.StateChanged(first, CallStatus.CANCELLED, EndReason.SKIPPED, a, null, List.of(a, b)));
        service.join(a, null); // skipper searches again; b (previous partner) is not queued, c is
        service.join(c, null);
        assertThat(createdCalls).hasSize(2);
        assertThat(Set.of(createdCalls.get(1))).containsExactlyInAnyOrder(a, c);
    }
}
