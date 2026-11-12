package com.englishspeaking.platform.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/** Opaque random tokens; only their SHA-256 hash is ever persisted. */
public final class TokenGenerator {
    private static final SecureRandom RANDOM = new SecureRandom();

    private TokenGenerator() {}

    public static String newToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** A six-digit code for typing on a phone. Only safe because it is tied to one account, expires quickly and dies after a few wrong guesses. */
    public static String newCode() {
        return String.format("%06d", RANDOM.nextInt(1_000_000));
    }

    /** The stored form of a code: bound to the account so equal codes of different people never match each other. */
    public static String hashCode(java.util.UUID userId, String code) {
        return hash("code:" + userId + ":" + code.strip());
    }

    public static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
