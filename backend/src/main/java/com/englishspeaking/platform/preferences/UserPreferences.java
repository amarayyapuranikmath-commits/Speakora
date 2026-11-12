package com.englishspeaking.platform.preferences;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_preferences")
public class UserPreferences {
    @Id
    @Column(name = "user_id")
    private UUID userId;
    @Column(name = "match_similar_level", nullable = false)
    private boolean matchSimilarLevel = true;
    @Column(name = "show_country", nullable = false)
    private boolean showCountry = true;
    @Column(name = "show_level", nullable = false)
    private boolean showLevel = true;
    @Column(name = "allow_partner_requests", nullable = false)
    private boolean allowPartnerRequests = true;
    @Column(name = "notify_email_reminders", nullable = false)
    private boolean notifyEmailReminders;
    @Column(name = "last_reminder_at")
    private Instant lastReminderAt;
    @Column(name = "ai_coach_consent", nullable = false)
    private boolean aiCoachConsent;
    @Column(name = "ai_coach_consent_at")
    private Instant aiCoachConsentAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected UserPreferences() {}

    public UserPreferences(UUID userId) { this.userId = userId; }

    @PrePersist @PreUpdate void touch() { updatedAt = Instant.now(); }

    public UUID getUserId() { return userId; }
    public boolean isMatchSimilarLevel() { return matchSimilarLevel; }
    public void setMatchSimilarLevel(boolean v) { this.matchSimilarLevel = v; }
    public boolean isShowCountry() { return showCountry; }
    public void setShowCountry(boolean v) { this.showCountry = v; }
    public boolean isShowLevel() { return showLevel; }
    public void setShowLevel(boolean v) { this.showLevel = v; }
    public boolean isAllowPartnerRequests() { return allowPartnerRequests; }
    public void setAllowPartnerRequests(boolean v) { this.allowPartnerRequests = v; }
    public boolean isNotifyEmailReminders() { return notifyEmailReminders; }
    public void setNotifyEmailReminders(boolean v) { this.notifyEmailReminders = v; }
    public boolean isAiCoachConsent() { return aiCoachConsent; }
    /** Records when consent was given; withdrawing clears the timestamp. */
    public void setAiCoachConsent(boolean consent) {
        if (consent && !aiCoachConsent) aiCoachConsentAt = Instant.now();
        if (!consent) aiCoachConsentAt = null;
        this.aiCoachConsent = consent;
    }
    public Instant getLastReminderAt() { return lastReminderAt; }
    public void setLastReminderAt(Instant at) { this.lastReminderAt = at; }
}
