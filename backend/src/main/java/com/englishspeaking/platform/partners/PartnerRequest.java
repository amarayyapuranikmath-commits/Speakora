package com.englishspeaking.platform.partners;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

/** One request to talk again, from someone to a previous partner. Nothing happens until the target accepts. */
@Entity
@Table(name = "partner_requests")
public class PartnerRequest {
    @Id
    private UUID id;
    @Column(name = "requester_id", nullable = false, updatable = false)
    private UUID requesterId;
    @Column(name = "target_id", nullable = false, updatable = false)
    private UUID targetId;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PartnerRequestStatus status = PartnerRequestStatus.PENDING;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;
    @Column(name = "responded_at")
    private Instant respondedAt;
    @Column(name = "call_id")
    private UUID callId;

    protected PartnerRequest() {}

    public PartnerRequest(UUID id, UUID requesterId, UUID targetId, Instant now, Instant expiresAt) {
        this.id = id;
        this.requesterId = requesterId;
        this.targetId = targetId;
        this.createdAt = now;
        this.expiresAt = expiresAt;
    }

    public boolean isPending() { return status == PartnerRequestStatus.PENDING; }

    public boolean isExpiredAt(Instant now) { return !now.isBefore(expiresAt); }

    /** Closes the request; only a pending one can be closed, so the first answer wins. */
    public void close(PartnerRequestStatus outcome, Instant now) {
        if (!isPending()) throw new IllegalStateException("Request " + id + " is already " + status);
        this.status = outcome;
        this.respondedAt = now;
    }

    public void accept(UUID callId, Instant now) {
        close(PartnerRequestStatus.ACCEPTED, now);
        this.callId = callId;
    }

    public UUID getId() { return id; }
    public UUID getRequesterId() { return requesterId; }
    public UUID getTargetId() { return targetId; }
    public PartnerRequestStatus getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getRespondedAt() { return respondedAt; }
    public UUID getCallId() { return callId; }
}
