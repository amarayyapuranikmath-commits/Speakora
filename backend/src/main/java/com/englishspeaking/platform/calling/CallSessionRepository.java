package com.englishspeaking.platform.calling;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CallSessionRepository extends JpaRepository<CallSession, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CallSession c where c.id = :id")
    Optional<CallSession> findByIdForUpdate(@Param("id") UUID id);

    @Query("""
            select c from CallSession c join CallParticipant p on p.id.callId = c.id
            where p.id.userId = :userId and c.status in :statuses order by c.createdAt desc
            """)
    Page<CallSession> findForUser(@Param("userId") UUID userId, @Param("statuses") Collection<CallStatus> statuses, Pageable pageable);

    @Query("""
            select count(c) from CallSession c join CallParticipant p on p.id.callId = c.id
            where p.id.userId in :userIds and c.status in :statuses
            """)
    long countActiveForUsers(@Param("userIds") Collection<UUID> userIds, @Param("statuses") Collection<CallStatus> statuses);

    @Query("""
            select c from CallSession c join CallParticipant p on p.id.callId = c.id
            where p.id.userId = :userId and c.status in :statuses
            """)
    List<CallSession> findActiveForUser(@Param("userId") UUID userId, @Param("statuses") Collection<CallStatus> statuses);

    @Query("""
            select distinct p.id.userId from CallSession c join CallParticipant p on p.id.callId = c.id
            where p.id.userId in :userIds and c.status in :statuses
            """)
    List<UUID> findUsersInActiveCalls(@Param("userIds") Collection<UUID> userIds, @Param("statuses") Collection<CallStatus> statuses);

    /** Rows of (partner id, call id, ended at) for calls both people were in, newest first. Used for "previous partners": only Quick Match calls count, so private calls with friends do not. */
    @Query("""
            select o.id.userId, c.id, c.endedAt
            from CallParticipant m
            join CallParticipant o on o.id.callId = m.id.callId and o.id.userId <> m.id.userId
            join CallSession c on c.id = m.id.callId
            where m.id.userId = :me and c.status = :status and c.durationSeconds >= :minSeconds
              and c.kind = com.englishspeaking.platform.calling.CallKind.RANDOM
            order by c.endedAt desc
            """)
    List<Object[]> findSharedCalls(@Param("me") UUID me, @Param("status") CallStatus status, @Param("minSeconds") int minSeconds, Pageable pageable);

    @Query("select c.id from CallSession c where c.status in :statuses and c.createdAt < :before")
    List<UUID> findStaleIds(@Param("statuses") Collection<CallStatus> statuses, @Param("before") Instant before);
}
