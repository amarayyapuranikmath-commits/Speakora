package com.englishspeaking.platform.moderation;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

public interface UserReportRepository extends JpaRepository<UserReport, UUID> {
    boolean existsByReporterIdAndCallId(UUID reporterId, UUID callId);

    @Query("select r from UserReport r where (:status is null or r.status = :status) order by r.createdAt desc")
    Page<UserReport> findByStatus(@Param("status") String status, Pageable pageable);

    long countByReportedIdAndStatus(UUID reportedId, String status);

    long countByReportedId(UUID reportedId);
}
