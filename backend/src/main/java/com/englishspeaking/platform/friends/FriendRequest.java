package com.englishspeaking.platform.friends;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "friend_requests")
public class FriendRequest {
    @Id
    private UUID id;
    @Column(name = "requester_id", nullable = false, updatable = false)
    private UUID requesterId;
    @Column(name = "target_id", nullable = false, updatable = false)
    private UUID targetId;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private FriendRequestStatus status = FriendRequestStatus.PENDING;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "responded_at")
    private Instant respondedAt;

    protected FriendRequest() {}

    public FriendRequest(UUID id, UUID requesterId, UUID targetId, Instant now) {
        this.id = id;
        this.requesterId = requesterId;
        this.targetId = targetId;
        this.createdAt = now;
    }

    public boolean isPending() { return status == FriendRequestStatus.PENDING; }

    /** Only an open request can be answered, so the first answer wins. */
    public void close(FriendRequestStatus outcome, Instant now) {
        if (!isPending()) throw new IllegalStateException("Friend request " + id + " is already " + status);
        this.status = outcome;
        this.respondedAt = now;
    }

    public UUID getId() { return id; }
    public UUID getRequesterId() { return requesterId; }
    public UUID getTargetId() { return targetId; }
    public FriendRequestStatus getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getRespondedAt() { return respondedAt; }
}
