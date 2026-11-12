package com.englishspeaking.platform.friends;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/** One person's own view of a conversation: when they last cleared it ("delete for me") and last read it. */
@Entity
@Table(name = "conversation_state")
public class ConversationState {
    @Embeddable
    public record Key(@Column(name = "user_id") UUID userId, @Column(name = "other_id") UUID otherId) implements Serializable {}

    @EmbeddedId
    private Key id;
    @Column(name = "cleared_at")
    private Instant clearedAt;
    @Column(name = "last_read_at")
    private Instant lastReadAt;

    protected ConversationState() {}

    public ConversationState(UUID userId, UUID otherId) { this.id = new Key(userId, otherId); }

    public Instant getClearedAt() { return clearedAt; }
    public Instant getLastReadAt() { return lastReadAt; }
    public void setClearedAt(Instant v) { this.clearedAt = v; }
    public void setLastReadAt(Instant v) { this.lastReadAt = v; }

    /** Messages at or before this moment are not shown to the owner. */
    public Instant visibleAfter() { return clearedAt == null ? Instant.EPOCH : clearedAt; }

    /** Messages after this moment, from the other person, count as unread. */
    public Instant unreadAfter() {
        Instant c = visibleAfter();
        return lastReadAt != null && lastReadAt.isAfter(c) ? lastReadAt : c;
    }
}
