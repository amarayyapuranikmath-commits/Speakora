package com.englishspeaking.platform.statistics;

import com.englishspeaking.platform.TestSupport;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class StatisticsServiceTest {
    @Mock UserStatisticsRepository stats;
    @Mock DailyActivityRepository daily;
    @Mock UserProfileRepository profiles;

    final TestSupport.MutableClock clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T20:00:00Z"));
    final UUID user = UUID.randomUUID();
    StatisticsService service;

    @BeforeEach
    void setUp() {
        service = new StatisticsService(stats, daily, profiles, clock);
        when(stats.findById(user)).thenReturn(Optional.empty());
    }

    private void zone(String tz) {
        UserProfile p = new UserProfile(user, "Ana");
        p.setTimeZone(tz);
        when(profiles.findById(user)).thenReturn(Optional.of(p));
    }

    @Test
    void aLateEveningCallCountsTowardTheUsersLocalDayNotUtc() {
        zone("Asia/Kolkata"); // UTC+5:30: 20:00 UTC is 01:30 on the NEXT local day
        service.recordCompletedCall(user, 600, Instant.parse("2026-11-09T20:00:00Z"));
        verify(daily).addActivity(user, LocalDate.of(2026, 11, 10), 600);
    }

    @Test
    void westernZonesCountTheEarlierDay() {
        zone("America/Los_Angeles"); // 2026-11-10T03:00Z is still 19:00 on the 9th in Los Angeles
        service.recordCompletedCall(user, 60, Instant.parse("2026-11-10T03:00:00Z"));
        verify(daily).addActivity(user, LocalDate.of(2026, 11, 9), 60);
    }

    @Test
    void missingOrUnknownZonesFallBackToUtcInsteadOfFailing() {
        when(profiles.findById(user)).thenReturn(Optional.empty());
        service.recordCompletedCall(user, 60, Instant.parse("2026-11-09T23:30:00Z"));
        verify(daily).addActivity(user, LocalDate.of(2026, 11, 9), 60);

        zone("Not/AZone");
        service.recordCompletedCall(user, 60, Instant.parse("2026-11-09T23:30:00Z"));
        verify(daily, times(2)).addActivity(user, LocalDate.of(2026, 11, 9), 60);
    }

    @Test
    void todayAndTheActivityWindowFollowTheUsersZone() {
        zone("Asia/Kolkata"); // clock = 2026-11-09T20:00Z = 01:30 on Nov 10 locally
        when(daily.findRange(eq(user), any(), any())).thenReturn(List.of());
        var points = service.activity(user, 3);
        assertThat(points).extracting(StatisticsService.DayPoint::date)
                .containsExactly(LocalDate.of(2026, 11, 8), LocalDate.of(2026, 11, 9), LocalDate.of(2026, 11, 10));
        verify(daily).findRange(user, LocalDate.of(2026, 11, 8), LocalDate.of(2026, 11, 10));
    }
}
