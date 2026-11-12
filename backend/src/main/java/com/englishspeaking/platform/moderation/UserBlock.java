package com.englishspeaking.platform.moderation;

import jakarta.persistence.*;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_blocks")
public class UserBlock {
    @Embeddable
    public record Key(@Column(name = "blocker_id") UUID blockerId, @Column(name = "blocked_id") UUID blockedId) implements Serializable {}

    @EmbeddedId
    private Key id;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected UserBlock() {}

    public UserBlock(UUID blockerId, UUID blockedId) { this.id = new Key(blockerId, blockedId); }

    public Key getId() { return id; }
    public Instant getCreatedAt() { return createdAt; }
}
