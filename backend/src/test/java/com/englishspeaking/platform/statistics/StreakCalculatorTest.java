package com.englishspeaking.platform.statistics;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class StreakCalculatorTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 9);

    @Test
    void firstEverActivityStartsStreakAtOne() { assertThat(StreakCalculator.next(null, 0, TODAY)).isEqualTo(1); }

    @Test
    void sameDayDoesNotIncrease() { assertThat(StreakCalculator.next(TODAY, 4, TODAY)).isEqualTo(4); }

    @Test
    void consecutiveDayExtends() { assertThat(StreakCalculator.next(TODAY.minusDays(1), 4, TODAY)).isEqualTo(5); }

    @Test
    void gapResetsToOne() { assertThat(StreakCalculator.next(TODAY.minusDays(3), 9, TODAY)).isEqualTo(1); }

    @Test
    void effectiveStreakExpiresAfterAMissedDay() {
        assertThat(StreakCalculator.effective(TODAY, 3, TODAY)).isEqualTo(3);
        assertThat(StreakCalculator.effective(TODAY.minusDays(1), 3, TODAY)).isEqualTo(3);
        assertThat(StreakCalculator.effective(TODAY.minusDays(2), 3, TODAY)).isZero();
        assertThat(StreakCalculator.effective(null, 0, TODAY)).isZero();
    }

    @Test
    void userStatisticsTracksLongestStreak() {
        var stats = new UserStatistics(java.util.UUID.randomUUID());
        stats.recordCall(60, TODAY.minusDays(2));
        stats.recordCall(60, TODAY.minusDays(1));
        stats.recordCall(30, TODAY);
        stats.recordCall(30, TODAY.plusDays(5));
        assertThat(stats.getTotalSeconds()).isEqualTo(180);
        assertThat(stats.getCompletedCalls()).isEqualTo(4);
        assertThat(stats.getCurrentStreakDays()).isEqualTo(1);
        assertThat(stats.getLongestStreakDays()).isEqualTo(3);
    }
}
