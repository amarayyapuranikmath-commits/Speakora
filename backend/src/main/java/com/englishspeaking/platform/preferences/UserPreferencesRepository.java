package com.englishspeaking.platform.preferences;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;

import java.util.UUID;

public interface UserPreferencesRepository extends JpaRepository<UserPreferences, UUID> {
    /** Opted-in, active, verified users who have not been reminded since {@code cutoff}. */
    @Query("""
            select p from UserPreferences p, User u
            where u.id = p.userId and p.notifyEmailReminders = true
              and u.status = com.englishspeaking.platform.user.UserStatus.ACTIVE and u.emailVerified = true
              and (p.lastReminderAt is null or p.lastReminderAt < :cutoff)
            """)
    Page<UserPreferences> findReminderCandidates(@Param("cutoff") Instant cutoff, Pageable pageable);
}
