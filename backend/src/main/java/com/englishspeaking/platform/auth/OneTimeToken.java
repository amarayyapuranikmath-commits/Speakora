package com.englishspeaking.platform.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;

import java.time.Instant;
import java.util.UUID;

/** Shared shape of email-verification and password-reset tokens: only a SHA-256 hash is stored. */
@MappedSuperclass
public abstract class OneTimeToken {
    @Id
    private UUID id;
    @Column(name = "user_id", nullable = false)
    private UUID userId;
    @Column(name = "token_hash", nullable = false, unique = true)
    private String tokenHash;
    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;
    @Column(name = "used_at")
    private Instant usedAt;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();
    @Column(name = "code_hash")
    private String codeHash;
    @Column(name = "failed_attempts", nullable = false)
    private int failedAttempts;

    protected OneTimeToken() {}

    protected OneTimeToken(UUID userId, String tokenHash, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
    }

    protected OneTimeToken(UUID userId, String tokenHash, Instant expiresAt, String codeHash) {
        this(userId, tokenHash, expiresAt);
        this.codeHash = codeHash;
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public Instant getCreatedAt() { return createdAt; }
    void setCreatedAt(Instant at) { this.createdAt = at; }
    public String getCodeHash() { return codeHash; }
    public int getFailedAttempts() { return failedAttempts; }
    public void recordFailedAttempt() { failedAttempts++; }
    public boolean isUsable(Instant now) { return usedAt == null && expiresAt.isAfter(now); }
    public void markUsed(Instant now) { this.usedAt = now; }
}
