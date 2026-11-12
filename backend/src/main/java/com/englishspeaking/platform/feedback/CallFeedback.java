package com.englishspeaking.platform.feedback;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "call_feedback")
public class CallFeedback {
    @Id
    private UUID id;
    @Column(name = "call_id", nullable = false)
    private UUID callId;
    @Column(name = "author_id", nullable = false)
    private UUID authorId;
    @Column(nullable = false)
    private short rating;
    @Column(name = "partner_was_respectful")
    private Boolean partnerWasRespectful;
    private String comment;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected CallFeedback() {}

    public CallFeedback(UUID callId, UUID authorId, short rating, Boolean partnerWasRespectful, String comment) {
        this.id = UUID.randomUUID();
        this.callId = callId;
        this.authorId = authorId;
        this.rating = rating;
        this.partnerWasRespectful = partnerWasRespectful;
        this.comment = comment;
    }

    public UUID getCallId() { return callId; }
    public short getRating() { return rating; }
}
