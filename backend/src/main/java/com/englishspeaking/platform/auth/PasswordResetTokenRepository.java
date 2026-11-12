package com.englishspeaking.platform.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, UUID> {
    Optional<PasswordResetToken> findByTokenHash(String tokenHash);

    Optional<PasswordResetToken> findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(UUID userId);

    /** Once a newer code has been emailed, everything issued before it stops working (only the newest email counts). */
    @Modifying(flushAutomatically = true)
    @Query("update PasswordResetToken t set t.usedAt = :now where t.userId = :userId and t.usedAt is null and t.id <> :keep")
    int retireOthers(@Param("userId") UUID userId, @Param("keep") UUID keep, @Param("now") Instant now);
}
