package com.englishspeaking.platform.profile;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "user_profiles")
public class UserProfile {
    @Id
    @Column(name = "user_id")
    private UUID userId;
    @Column(name = "display_name", nullable = false)
    private String displayName;
    private String country;
    @Column(name = "time_zone")
    private String timeZone;
    @Column(name = "native_language")
    private String nativeLanguage;
    @Enumerated(EnumType.STRING)
    @Column(name = "english_level")
    private EnglishLevel englishLevel;
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "learning_goals", columnDefinition = "text[]", nullable = false)
    private List<String> learningGoals = new ArrayList<>();
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "text[]", nullable = false)
    private List<String> interests = new ArrayList<>();
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected UserProfile() {}

    public UserProfile(UUID userId, String displayName) {
        this.userId = userId;
        this.displayName = displayName;
    }

    @PrePersist @PreUpdate void touch() { updatedAt = Instant.now(); }

    public UUID getUserId() { return userId; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
    public String getCountry() { return country; }
    public void setCountry(String country) { this.country = country; }
    public String getTimeZone() { return timeZone; }
    public void setTimeZone(String timeZone) { this.timeZone = timeZone; }
    public String getNativeLanguage() { return nativeLanguage; }
    public void setNativeLanguage(String nativeLanguage) { this.nativeLanguage = nativeLanguage; }
    public EnglishLevel getEnglishLevel() { return englishLevel; }
    public void setEnglishLevel(EnglishLevel englishLevel) { this.englishLevel = englishLevel; }
    public List<String> getLearningGoals() { return learningGoals; }
    public void setLearningGoals(List<String> goals) { this.learningGoals = new ArrayList<>(goals); }
    public List<String> getInterests() { return interests; }
    public void setInterests(List<String> interests) { this.interests = new ArrayList<>(interests); }
}
