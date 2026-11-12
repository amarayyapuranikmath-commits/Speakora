package com.englishspeaking.platform.friends;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/** Stored once per pair, smaller id first. */
@Entity
@Table(name = "friendships")
public class Friendship {
    @Embeddable
    public record Key(@Column(name = "user_a") UUID userA, @Column(name = "user_b") UUID userB) implements Serializable {
        public static Key of(UUID x, UUID y) { return compare(x, y) < 0 ? new Key(x, y) : new Key(y, x); }

        /** Byte-wise (unsigned) order, which is how PostgreSQL orders uuid values. {@link UUID#compareTo} is signed and would disagree. */
        public static int compare(UUID x, UUID y) {
            int c = Long.compareUnsigned(x.getMostSignificantBits(), y.getMostSignificantBits());
            return c != 0 ? c : Long.compareUnsigned(x.getLeastSignificantBits(), y.getLeastSignificantBits());
        }
        public UUID other(UUID me) { return me.equals(userA) ? userB : userA; }
    }

    @EmbeddedId
    private Key id;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Friendship() {}

    public Friendship(UUID x, UUID y, Instant now) {
        this.id = Key.of(x, y);
        this.createdAt = now;
    }

    public Key getId() { return id; }
    public Instant getCreatedAt() { return createdAt; }
}
