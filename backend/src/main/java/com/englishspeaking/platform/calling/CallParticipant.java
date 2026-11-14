package com.englishspeaking.platform.calling;

import jakarta.persistence.*;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "call_participants")
public class CallParticipant implements org.springframework.data.domain.Persistable<CallParticipant.Key> {
    @Embeddable
    public record Key(@Column(name = "call_id") UUID callId, @Column(name = "user_id") UUID userId) implements Serializable {}

    @EmbeddedId
    private Key id;
    @Column(name = "joined_at")
    private Instant joinedAt;
    @Column(name = "left_at")
    private Instant leftAt;

    /**
     * True until this object has been saved or loaded. These entities get their id from the application, so without this Spring Data cannot tell a new
     * row from an existing one and runs a SELECT before every INSERT (a wasted database round trip per row when a call is created).
     */
    @Transient
    private boolean newRow = true;

    @Override
    public boolean isNew() { return newRow; }

    @PostLoad
    @PostPersist
    void markNotNew() { newRow = false; }

    protected CallParticipant() {}

    public CallParticipant(UUID callId, UUID userId) { this.id = new Key(callId, userId); }

    public Key getId() { return id; }
    public UUID getUserId() { return id.userId(); }
    public Instant getJoinedAt() { return joinedAt; }
    public void markJoined(Instant at) { if (joinedAt == null) joinedAt = at; }
    public void markLeft(Instant at) { if (leftAt == null) leftAt = at; }
}
