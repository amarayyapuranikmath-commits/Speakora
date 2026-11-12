package com.englishspeaking.platform.moderation;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

/** Append-only audit trail of every moderator decision. */
@Entity
@Table(name = "moderation_actions")
public class ModerationAction {
    public enum Type { SUSPEND, UNSUSPEND, ACTION_REPORT, DISMISS_REPORT }

    @Id
    private UUID id = UUID.randomUUID();
    @Column(name = "admin_id")
    private UUID adminId;
    @Column(name = "target_user_id", nullable = false)
    private UUID targetUserId;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Type action;
    private String reason;
    @Column(name = "report_id")
    private UUID reportId;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected ModerationAction() {}

    public ModerationAction(UUID adminId, UUID targetUserId, Type action, String reason, UUID reportId) {
        this.adminId = adminId;
        this.targetUserId = targetUserId;
        this.action = action;
        this.reason = reason;
        this.reportId = reportId;
    }

    public UUID getAdminId() { return adminId; }
    public UUID getTargetUserId() { return targetUserId; }
    public Type getAction() { return action; }
    public String getReason() { return reason; }
    public Instant getCreatedAt() { return createdAt; }
}
