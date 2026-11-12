package com.englishspeaking.platform.learn;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/** Running totals of right and wrong answers per grammar topic, used to find weak areas. */
@Entity
@Table(name = "topic_stats")
public class TopicStat {
    @Embeddable
    public record Key(@Column(name = "user_id") UUID userId, @Column(name = "lesson_id") String lessonId) implements Serializable {}

    @EmbeddedId
    private Key id;
    private int correct;
    private int incorrect;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected TopicStat() {}

    public TopicStat(UUID userId, String lessonId, Instant now) {
        this.id = new Key(userId, lessonId);
        this.updatedAt = now;
    }

    public void add(int right, int wrong, Instant now) {
        correct += right;
        incorrect += wrong;
        updatedAt = now;
    }

    public String lessonId() { return id.lessonId(); }
    public int getCorrect() { return correct; }
    public int getIncorrect() { return incorrect; }
    public int answered() { return correct + incorrect; }
    public int accuracyPercent() { return answered() == 0 ? 100 : Math.round(100f * correct / answered()); }
}
