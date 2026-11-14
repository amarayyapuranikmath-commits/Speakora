package com.englishspeaking.platform.user;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.security.RateLimiter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.UUID;

/**
 * Creates the FIRST administrator without email. It works only when the server owner has set a secret ADMIN_BOOTSTRAP_TOKEN (at least 32 random
 * characters) in the server's own settings, only for a person who is already signed in, only while no administrator exists, and only with that exact
 * token. Registering with any email address never grants a role. Attempts are rate limited per account and for the whole server; the token is never
 * logged or returned.
 */
@Service
public class AdminClaimService {
    private static final Logger log = LoggerFactory.getLogger(AdminClaimService.class);
    static final int MIN_TOKEN_LENGTH = 32;

    private final UserRepository users;
    private final RateLimiter limiter;
    private final byte[] tokenDigest; // null = the mechanism is switched off

    public AdminClaimService(UserRepository users, RateLimiter limiter, @Value("${ADMIN_BOOTSTRAP_TOKEN:}") String token) {
        this.users = users;
        this.limiter = limiter;
        String t = token == null ? "" : token.trim();
        if (t.isEmpty()) {
            this.tokenDigest = null;
        } else if (t.length() < MIN_TOKEN_LENGTH) {
            log.warn("ADMIN_BOOTSTRAP_TOKEN is shorter than {} characters, so first-admin setup is switched off. Use a long random value.", MIN_TOKEN_LENGTH);
            this.tokenDigest = null;
        } else {
            this.tokenDigest = sha256(t);
        }
    }

    public boolean enabled() { return tokenDigest != null; }

    @Transactional
    public void claim(UUID userId, String token) {
        if (tokenDigest == null) throw ApiException.notFound("NOT_FOUND", "Not found.");
        if (!limiter.tryAcquire("admin-claim:user:" + userId, 5, Duration.ofMinutes(15))
                || !limiter.tryAcquire("admin-claim:all", 20, Duration.ofHours(1))) {
            throw ApiException.tooManyRequests("Too many attempts. Please wait a while before trying again.");
        }
        boolean tokenOk = token != null && MessageDigest.isEqual(tokenDigest, sha256(token.trim())); // compares digests: constant time, equal length
        if (!tokenOk) {
            log.warn("Refused a first-admin claim from user {}: wrong setup token", userId);
            throw ApiException.forbidden("FORBIDDEN", "That setup token is not correct.");
        }
        if (users.existsByRole("ADMIN")) {
            throw ApiException.conflict("ADMIN_EXISTS", "An administrator already exists. Ask them to give you access.");
        }
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("NOT_FOUND", "Account not found."));
        if (user.getStatus() != UserStatus.ACTIVE) throw ApiException.forbidden("FORBIDDEN", "This account cannot become an administrator.");
        user.setRole("ADMIN");
        log.info("User {} became the first ADMIN through ADMIN_BOOTSTRAP_TOKEN", userId);
    }

    private static byte[] sha256(String s) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
