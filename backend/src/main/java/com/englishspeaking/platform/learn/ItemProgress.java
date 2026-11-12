package com.englishspeaking.platform.learn;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * What a learner knows about one word or phrasal verb, with a simple five-box review schedule: every correct answer moves the item
 * up a box and schedules the next review further away; a wrong answer moves it back two boxes and brings the review forward.
 * An item counts as learned once it has been recalled correctly in three separate reviews (box 3 or higher).
 */
@Entity
@Table(name = "item_progress")
public class ItemProgress {
    public static final int LEARNED_BOX = 3;
    static final int[] INTERVAL_DAYS = {0, 1, 3, 7, 14, 30};

    @Embeddable
    public record Key(@Column(name = "user_id") UUID userId, @Column(name = "item_id") String itemId) implements Serializable {}

    @EmbeddedId
    private Key id;
    @Column(nullable = false)
    private String kind;
    private boolean saved;
    private int box;
    @Column(name = "correct_count")
    private int correctCount;
    @Column(name = "incorrect_count")
    private int incorrectCount;
    @Column(name = "last_reviewed_at")
    private Instant lastReviewedAt;
    @Column(name = "next_review_at")
    private Instant nextReviewAt;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected ItemProgress() {}

    public ItemProgress(UUID userId, String itemId, String kind, Instant now) {
        this.id = new Key(userId, itemId);
        this.kind = kind;
        this.createdAt = now;
    }

    /** Records one answer and schedules the next review. */
    public void review(boolean correct, Instant now) {
        lastReviewedAt = now;
        if (correct) {
            correctCount++;
            box = Math.min(5, box + 1);
        } else {
            incorrectCount++;
            box = Math.max(1, box - 2);
        }
        nextReviewAt = now.plus(Duration.ofDays(INTERVAL_DAYS[box]));
    }

    /** Saving a word puts it in the review queue straight away. */
    public void save(boolean value, Instant now) {
        saved = value;
        if (value && nextReviewAt == null) nextReviewAt = now;
    }

    public boolean isLearned() { return box >= LEARNED_BOX; }

    /** Missed more often than recalled, and still not secure. */
    public boolean isDifficult() { return incorrectCount >= 2 && incorrectCount > correctCount && box <= 2; }

    public boolean isUnused() { return !saved && box == 0 && correctCount == 0 && incorrectCount == 0; }

    public String itemId() { return id.itemId(); }
    public String getKind() { return kind; }
    public boolean isSaved() { return saved; }
    public int getBox() { return box; }
    public int getCorrectCount() { return correctCount; }
    public int getIncorrectCount() { return incorrectCount; }
    public Instant getNextReviewAt() { return nextReviewAt; }
}
