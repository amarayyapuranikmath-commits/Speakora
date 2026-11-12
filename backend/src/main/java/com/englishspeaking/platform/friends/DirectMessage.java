package com.englishspeaking.platform.friends;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "direct_messages")
public class DirectMessage {
    @Id
    private UUID id;
    @Column(name = "user_a", nullable = false, updatable = false)
    private UUID userA;
    @Column(name = "user_b", nullable = false, updatable = false)
    private UUID userB;
    @Column(name = "sender_id", nullable = false, updatable = false)
    private UUID senderId;
    @Column(nullable = false, updatable = false, length = 2000)
    private String body;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected DirectMessage() {}

    public DirectMessage(UUID id, UUID sender, UUID recipient, String body, Instant now) {
        Friendship.Key key = Friendship.Key.of(sender, recipient);
        this.id = id;
        this.userA = key.userA();
        this.userB = key.userB();
        this.senderId = sender;
        this.body = body;
        this.createdAt = now;
    }

    public UUID getId() { return id; }
    public UUID getSenderId() { return senderId; }
    public String getBody() { return body; }
    public Instant getCreatedAt() { return createdAt; }
}
