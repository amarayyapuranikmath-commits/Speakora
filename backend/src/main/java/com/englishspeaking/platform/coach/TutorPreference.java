package com.englishspeaking.platform.coach;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/** What the learner prefers from the tutor. Settings only: the coach conversation itself is never stored. */
@Entity
@Table(name = "tutor_preferences")
public class TutorPreference {
    @Id
    @Column(name = "user_id")
    private UUID userId;
    @Column(name = "explanation_language")
    private String explanationLanguage;
    @Column(name = "speech_speed", nullable = false)
    private String speechSpeed = "NORMAL";
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected TutorPreference() {}

    public TutorPreference(UUID userId, Instant now) {
        this.userId = userId;
        this.updatedAt = now;
    }

    public String getExplanationLanguage() { return explanationLanguage; }
    public String getSpeechSpeed() { return speechSpeed; }
    public void setSpeechSpeed(String speed, Instant now) {
        this.speechSpeed = speed;
        this.updatedAt = now;
    }

    public void setExplanationLanguage(String language, Instant now) {
        this.explanationLanguage = language;
        this.updatedAt = now;
    }
}
