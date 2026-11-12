package com.englishspeaking.platform.statistics;

import java.time.LocalDate;

public final class StreakCalculator {
    private StreakCalculator() {}

    /** Streak after practising on {@code day}, given the previous activity date and streak. */
    public static int next(LocalDate lastActivity, int currentStreak, LocalDate day) {
        if (lastActivity == null) return 1;
        if (day.equals(lastActivity)) return Math.max(currentStreak, 1);
        if (day.equals(lastActivity.plusDays(1))) return currentStreak + 1;
        if (day.isBefore(lastActivity)) return Math.max(currentStreak, 1);
        return 1;
    }

    /** Streak to display on {@code today}: a streak is still alive if the last activity was today or yesterday. */
    public static int effective(LocalDate lastActivity, int storedStreak, LocalDate today) {
        if (lastActivity == null) return 0;
        return (lastActivity.equals(today) || lastActivity.equals(today.minusDays(1))) ? storedStreak : 0;
    }
}
