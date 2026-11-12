package com.englishspeaking.platform.partners;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PartnerRequestRepository extends JpaRepository<PartnerRequest, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from PartnerRequest r where r.id = :id")
    Optional<PartnerRequest> findByIdForUpdate(@Param("id") UUID id);

    List<PartnerRequest> findByRequesterIdAndStatus(UUID requesterId, PartnerRequestStatus status);

    List<PartnerRequest> findByTargetIdAndStatus(UUID targetId, PartnerRequestStatus status);

    List<PartnerRequest> findByRequesterIdAndTargetIdAndStatus(UUID requesterId, UUID targetId, PartnerRequestStatus status);

    @Query("select r.id from PartnerRequest r where r.status = com.englishspeaking.platform.partners.PartnerRequestStatus.PENDING and r.expiresAt <= :now")
    List<UUID> findExpiredPendingIds(@Param("now") Instant now);

    @Query("select count(r) from PartnerRequest r where r.requesterId = :requester and r.createdAt > :since")
    long countSince(@Param("requester") UUID requester, @Param("since") Instant since);

    @Query("""
            select r from PartnerRequest r where r.requesterId = :requester and r.targetId = :target
              and r.status = com.englishspeaking.platform.partners.PartnerRequestStatus.DECLINED and r.respondedAt > :since
            order by r.respondedAt desc
            """)
    List<PartnerRequest> findDeclinedSince(@Param("requester") UUID requester, @Param("target") UUID target, @Param("since") Instant since);
}
