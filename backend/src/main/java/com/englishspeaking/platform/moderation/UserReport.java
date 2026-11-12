package com.englishspeaking.platform.moderation;

import com.englishspeaking.platform.common.ApiException;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_reports")
public class UserReport {
    public static final String OPEN = "OPEN";
    public static final String ACTIONED = "ACTIONED";
    public static final String DISMISSED = "DISMISSED";

    @Id
    private UUID id;
    @Column(name = "reporter_id", nullable = false)
    private UUID reporterId;
    @Column(name = "reported_id", nullable = false)
    private UUID reportedId;
    @Column(name = "call_id")
    private UUID callId;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ReportReason reason;
    private String details;
    @Column(nullable = false)
    private String status = OPEN;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();
    @Column(name = "resolved_at")
    private Instant resolvedAt;
    @Column(name = "resolved_by")
    private UUID resolvedBy;
    @Column(name = "resolution_note")
    private String resolutionNote;

    protected UserReport() {}

    public UserReport(UUID reporterId, UUID reportedId, UUID callId, ReportReason reason, String details) {
        this.id = UUID.randomUUID();
        this.reporterId = reporterId;
        this.reportedId = reportedId;
        this.callId = callId;
        this.reason = reason;
        this.details = details;
    }

    /** Closes an open report. Resolving twice is a conflict so two moderators cannot overwrite each other. */
    public void resolve(String newStatus, UUID adminId, String note, Instant at) {
        if (!OPEN.equals(status)) throw ApiException.conflict("REPORT_ALREADY_RESOLVED", "This report has already been resolved.");
        this.status = newStatus;
        this.resolvedBy = adminId;
        this.resolutionNote = note;
        this.resolvedAt = at;
    }

    public UUID getId() { return id; }
    public UUID getReporterId() { return reporterId; }
    public UUID getReportedId() { return reportedId; }
    public UUID getCallId() { return callId; }
    public ReportReason getReason() { return reason; }
    public String getDetails() { return details; }
    public String getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getResolvedAt() { return resolvedAt; }
    public String getResolutionNote() { return resolutionNote; }
}
