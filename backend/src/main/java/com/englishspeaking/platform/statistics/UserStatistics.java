package com.englishspeaking.platform.statistics;

import jakarta.persistence.*;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "user_statistics")
public class UserStatistics {
    @Id
    @Column(name = "user_id")
    private UUID userId;
    @Column(name = "total_seconds", nullable = false)
    private long totalSeconds;
    @Column(name = "completed_calls", nullable = false)
    private int completedCalls;
    @Column(name = "current_streak_days", nullable = false)
    private int currentStreakDays;
    @Column(name = "longest_streak_days", nullable = false)
    private int longestStreakDays;
    @Column(name = "last_activity_date")
    private LocalDate lastActivityDate;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected UserStatistics() {}

    public UserStatistics(UUID userId) { this.userId = userId; }

    @PrePersist @PreUpdate void touch() { updatedAt = Instant.now(); }

    public void recordCall(int seconds, LocalDate day) {
        totalSeconds += seconds;
        completedCalls++;
        currentStreakDays = StreakCalculator.next(lastActivityDate, currentStreakDays, day);
        longestStreakDays = Math.max(longestStreakDays, currentStreakDays);
        if (lastActivityDate == null || day.isAfter(lastActivityDate)) lastActivityDate = day;
    }

    public UUID getUserId() { return userId; }
    public long getTotalSeconds() { return totalSeconds; }
    public int getCompletedCalls() { return completedCalls; }
    public int getCurrentStreakDays() { return currentStreakDays; }
    public int getLongestStreakDays() { return longestStreakDays; }
    public LocalDate getLastActivityDate() { return lastActivityDate; }
}
