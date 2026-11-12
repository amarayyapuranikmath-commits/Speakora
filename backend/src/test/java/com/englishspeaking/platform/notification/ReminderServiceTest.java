package com.englishspeaking.platform.notification;

import com.englishspeaking.platform.TestSupport;
import com.englishspeaking.platform.preferences.UserPreferences;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.security.RateLimiter;
import com.englishspeaking.platform.statistics.UserStatistics;
import com.englishspeaking.platform.statistics.UserStatisticsRepository;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ReminderServiceTest {
    @Mock UserPreferencesRepository preferences;
    @Mock UserRepository users;
    @Mock UserProfileRepository profiles;
    @Mock UserStatisticsRepository statistics;
    @Mock MailService mail;
    @Mock RateLimiter limiter;

    // 2026-11-10T12:30Z = 18:00 in Asia/Kolkata (UTC+5:30), 13:30 in London
    final Instant evening = Instant.parse("2026-11-10T12:30:00Z");
    final TestSupport.MutableClock clock = new TestSupport.MutableClock(evening);
    ReminderService service;
    User user;
    UserPreferences prefs;
    UserProfile profile;

    @BeforeEach
    void setUp() {
        service = new ReminderService(preferences, users, profiles, statistics, mail, limiter, clock);
        user = new User("ana@example.com", "h", LocalDate.of(1990, 1, 1));
        prefs = new UserPreferences(user.getId());
        prefs.setNotifyEmailReminders(true);
        profile = new UserProfile(user.getId(), "Ana");
        profile.setTimeZone("Asia/Kolkata");
        when(preferences.findReminderCandidates(any(), any(Pageable.class))).thenReturn(new PageImpl<>(List.of(prefs)));
        when(users.findById(user.getId())).thenReturn(Optional.of(user));
        when(profiles.findById(user.getId())).thenReturn(Optional.of(profile));
        when(limiter.tryAcquire(anyString(), anyInt(), any())).thenReturn(true);
    }

    private void lastPractised(LocalDate day) {
        UserStatistics s = new UserStatistics(user.getId());
        s.recordCall(60, day);
        when(statistics.findById(user.getId())).thenReturn(Optional.of(s));
    }

    @Test
    void remindsAfterQuietDaysInTheEveningOfTheUsersOwnZone() {
        lastPractised(LocalDate.of(2026, 11, 7));
        assertThat(service.sendDue(evening)).isEqualTo(1);
        verify(mail).sendReminderEmail("ana@example.com", "Ana");
        assertThat(prefs.getLastReminderAt()).isEqualTo(evening);
    }

    @Test
    void doesNotNagSomeoneWhoPractisedRecently() {
        lastPractised(LocalDate.of(2026, 11, 9)); // yesterday locally
        assertThat(service.sendDue(evening)).isZero();
        verify(mail, never()).sendReminderEmail(any(), any());
        assertThat(prefs.getLastReminderAt()).isNull();
    }

    @Test
    void onlySendsInsideTheEveningWindowLocally() {
        lastPractised(LocalDate.of(2026, 11, 1));
        assertThat(service.sendDue(Instant.parse("2026-11-10T03:00:00Z"))).isZero();   // 08:30 in Kolkata
        assertThat(service.sendDue(Instant.parse("2026-11-10T15:00:00Z"))).isZero();   // 20:30 in Kolkata (window closed)
        verify(mail, never()).sendReminderEmail(any(), any());
    }

    @Test
    void brandNewUsersWhoNeverPractisedAreLeftAloneForTheFirstDays() {
        when(statistics.findById(user.getId())).thenReturn(Optional.empty());
        // created_at is "now" (set at construction), so the quiet-day rule has not elapsed
        user = spy(user);
        when(users.findById(prefs.getUserId())).thenReturn(Optional.of(user));
        when(user.getCreatedAt()).thenReturn(evening.minus(Duration.ofHours(10)));
        assertThat(service.sendDue(evening)).isZero();
        when(user.getCreatedAt()).thenReturn(evening.minus(Duration.ofDays(5)));
        assertThat(service.sendDue(evening)).isEqualTo(1);
    }

    @Test
    void unknownTimeZoneFallsBackToUtcInsteadOfFailing() {
        profile.setTimeZone("Not/AZone");
        lastPractised(LocalDate.of(2026, 11, 1));
        // 12:30 UTC is outside the 17-20 window, so no mail, and no exception
        assertThat(service.sendDue(evening)).isZero();
        assertThat(service.sendDue(Instant.parse("2026-11-10T18:00:00Z"))).isEqualTo(1);
    }

    @Test
    void onlyOneInstanceRunsTheHourlyJob() {
        when(limiter.tryAcquire(anyString(), eq(1), any())).thenReturn(false);
        service.run();
        verifyNoInteractions(preferences);
    }
}
