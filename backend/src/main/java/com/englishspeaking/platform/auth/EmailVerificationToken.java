package com.englishspeaking.platform.auth;

import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "email_verification_tokens")
public class EmailVerificationToken extends OneTimeToken {
    protected EmailVerificationToken() {}

    public EmailVerificationToken(UUID userId, String tokenHash, Instant expiresAt) { super(userId, tokenHash, expiresAt); }

    public EmailVerificationToken(UUID userId, String tokenHash, Instant expiresAt, String codeHash) { super(userId, tokenHash, expiresAt, codeHash); }
}
