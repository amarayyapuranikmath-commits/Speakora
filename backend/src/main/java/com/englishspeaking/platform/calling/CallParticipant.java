package com.englishspeaking.platform.calling;

import jakarta.persistence.*;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "call_participants")
public class CallParticipant {
    @Embeddable
    public record Key(@Column(name = "call_id") UUID callId, @Column(name = "user_id") UUID userId) implements Serializable {}

    @EmbeddedId
    private Key id;
    @Column(name = "joined_at")
    private Instant joinedAt;
    @Column(name = "left_at")
    private Instant leftAt;

    protected CallParticipant() {}

    public CallParticipant(UUID callId, UUID userId) { this.id = new Key(callId, userId); }

    public Key getId() { return id; }
    public UUID getUserId() { return id.userId(); }
    public Instant getJoinedAt() { return joinedAt; }
    public void markJoined(Instant at) { if (joinedAt == null) joinedAt = at; }
    public void markLeft(Instant at) { if (leftAt == null) leftAt = at; }
}
