package com.englishspeaking.platform.calling;

import com.englishspeaking.platform.common.ApiException;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "call_sessions")
public class CallSession {
    @Id
    private UUID id;
    @Column(name = "topic_id")
    private UUID topicId;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private CallStatus status;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "connected_at")
    private Instant connectedAt;
    @Column(name = "ended_at")
    private Instant endedAt;
    @Column(name = "duration_seconds")
    private Integer durationSeconds;
    @Enumerated(EnumType.STRING)
    @Column(name = "end_reason")
    private EndReason endReason;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private CallKind kind = CallKind.RANDOM;

    protected CallSession() {}

    public CallSession(UUID id, UUID topicId, Instant now) { this(id, topicId, now, CallKind.RANDOM); }

    public CallSession(UUID id, UUID topicId, Instant now, CallKind kind) {
        this.kind = kind;
        this.id = id;
        this.topicId = topicId;
        this.status = CallStatus.MATCH_FOUND;
        this.createdAt = now;
    }

    /** Applies a state change, rejecting transitions the state machine does not allow. */
    public void transitionTo(CallStatus next) {
        if (!status.canTransitionTo(next)) {
            throw ApiException.conflict("INVALID_CALL_STATE", "Call cannot move from " + status + " to " + next + ".");
        }
        status = next;
    }

    public void markConnected(Instant now) {
        transitionTo(CallStatus.CONNECTED);
        if (connectedAt == null) connectedAt = now;
    }

    public void finish(CallStatus terminal, EndReason reason, Instant now) {
        transitionTo(terminal);
        this.endReason = reason;
        this.endedAt = now;
        if (connectedAt != null) this.durationSeconds = (int) Math.max(0, java.time.Duration.between(connectedAt, now).getSeconds());
    }

    public UUID getId() { return id; }
    public UUID getTopicId() { return topicId; }
    public CallStatus getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getConnectedAt() { return connectedAt; }
    public Instant getEndedAt() { return endedAt; }
    public Integer getDurationSeconds() { return durationSeconds; }
    public EndReason getEndReason() { return endReason; }
    public CallKind getKind() { return kind; }
}
