package com.englishspeaking.platform.learn;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.time.LocalDate;
import java.util.UUID;

/** A day (UTC) on which the learner really practised: took a test or a review. Drives the learning streak. */
@Entity
@Table(name = "learning_days")
public class LearningDay {
    @Embeddable
    public record Key(@Column(name = "user_id") UUID userId, @Column(name = "day") LocalDate day) implements Serializable {}

    @EmbeddedId
    private Key id;
    private int actions;

    protected LearningDay() {}

    public LearningDay(UUID userId, LocalDate day) {
        this.id = new Key(userId, day);
        this.actions = 0;
    }

    public void touch() { actions++; }

    public LocalDate day() { return id.day(); }
    public int getActions() { return actions; }
}
