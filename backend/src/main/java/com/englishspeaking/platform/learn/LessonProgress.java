package com.englishspeaking.platform.learn;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/** A learner's result for one lesson: how many times they were tested, their scores, and when they first passed. */
@Entity
@Table(name = "lesson_progress")
public class LessonProgress {
    @Embeddable
    public record Key(@Column(name = "user_id") UUID userId, @Column(name = "lesson_id") String lessonId) implements Serializable {}

    @EmbeddedId
    private Key id;
    private int attempts;
    @Column(name = "best_percent")
    private int bestPercent;
    @Column(name = "last_percent")
    private int lastPercent;
    @Column(name = "completed_at")
    private Instant completedAt;
    @Column(name = "last_attempt_at", nullable = false)
    private Instant lastAttemptAt;

    protected LessonProgress() {}

    public LessonProgress(UUID userId, String lessonId, Instant now) {
        this.id = new Key(userId, lessonId);
        this.lastAttemptAt = now;
    }

    public void record(int percent, boolean passed, Instant now) {
        attempts++;
        lastPercent = percent;
        bestPercent = Math.max(bestPercent, percent);
        lastAttemptAt = now;
        if (passed && completedAt == null) completedAt = now;
    }

    public Key getId() { return id; }
    public int getAttempts() { return attempts; }
    public int getBestPercent() { return bestPercent; }
    public int getLastPercent() { return lastPercent; }
    public Instant getCompletedAt() { return completedAt; }
    public boolean isCompleted() { return completedAt != null; }
}
