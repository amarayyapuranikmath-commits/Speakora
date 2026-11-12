package com.englishspeaking.platform.statistics;

import com.englishspeaking.platform.profile.EnglishLevel;
import com.englishspeaking.platform.profile.UserProfileRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class StatisticsService {
    public record Summary(long totalSeconds, int completedCalls, int currentStreakDays, int longestStreakDays,
                          long weekSeconds, long monthSeconds, boolean practisedToday, EnglishLevel englishLevel) {}

    public record DayPoint(LocalDate date, int seconds, int calls) {}

    private final UserStatisticsRepository stats;
    private final DailyActivityRepository daily;
    private final UserProfileRepository profiles;
    private final Clock clock;

    public StatisticsService(UserStatisticsRepository stats, DailyActivityRepository daily, UserProfileRepository profiles, Clock clock) {
        this.stats = stats;
        this.daily = daily;
        this.profiles = profiles;
        this.clock = clock;
    }

    /**
     * Called inside the call-completion transaction so stats and call status never diverge. The call counts toward the day it
     * ended in the USER'S time zone (UTC if they have none), so a 01:30 call in India is that local day's practice.
     */
    @Transactional
    public void recordCompletedCall(UUID userId, int seconds, Instant endedAt) {
        LocalDate day = LocalDate.ofInstant(endedAt, zoneOf(userId));
        UserStatistics s = stats.findById(userId).orElseGet(() -> new UserStatistics(userId));
        s.recordCall(seconds, day);
        stats.save(s);
        daily.addActivity(userId, day, seconds);
    }

    @Transactional(readOnly = true)
    public Summary summary(UUID userId) {
        LocalDate today = today(userId);
        UserStatistics s = stats.findById(userId).orElseGet(() -> new UserStatistics(userId));
        EnglishLevel level = profiles.findById(userId).map(p -> p.getEnglishLevel()).orElse(null);
        return new Summary(s.getTotalSeconds(), s.getCompletedCalls(),
                StreakCalculator.effective(s.getLastActivityDate(), s.getCurrentStreakDays(), today), s.getLongestStreakDays(),
                daily.sumSeconds(userId, today.minusDays(6), today), daily.sumSeconds(userId, today.minusDays(29), today),
                today.equals(s.getLastActivityDate()), level);
    }

    @Transactional(readOnly = true)
    public List<DayPoint> activity(UUID userId, int days) {
        LocalDate today = today(userId);
        LocalDate from = today.minusDays(days - 1L);
        Map<LocalDate, DailyActivity> byDate = new HashMap<>();
        daily.findRange(userId, from, today).forEach(a -> byDate.put(a.getId().date(), a));
        List<DayPoint> points = new ArrayList<>(days);
        for (LocalDate d = from; !d.isAfter(today); d = d.plusDays(1)) {
            DailyActivity a = byDate.get(d);
            points.add(new DayPoint(d, a == null ? 0 : a.getSeconds(), a == null ? 0 : a.getCalls()));
        }
        return points;
    }

    private LocalDate today(UUID userId) { return LocalDate.now(clock.withZone(zoneOf(userId))); }

    private ZoneId zoneOf(UUID userId) {
        try {
            return profiles.findById(userId).map(p -> p.getTimeZone()).filter(tz -> tz != null && !tz.isBlank()).map(ZoneId::of).orElse(ZoneOffset.UTC);
        } catch (DateTimeException e) {
            return ZoneOffset.UTC; // a stored zone id that the JVM no longer knows
        }
    }
}
