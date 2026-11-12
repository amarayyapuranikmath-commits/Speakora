package com.englishspeaking.platform.friends;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FriendRequestRepository extends JpaRepository<FriendRequest, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from FriendRequest r where r.id = :id")
    Optional<FriendRequest> findByIdForUpdate(@Param("id") UUID id);

    List<FriendRequest> findByTargetIdAndStatus(UUID targetId, FriendRequestStatus status);

    List<FriendRequest> findByRequesterIdAndStatus(UUID requesterId, FriendRequestStatus status);

    @Query("""
            select r from FriendRequest r
            where ((r.requesterId = :a and r.targetId = :b) or (r.requesterId = :b and r.targetId = :a))
              and r.status = com.englishspeaking.platform.friends.FriendRequestStatus.PENDING
            """)
    List<FriendRequest> findPendingBetween(@Param("a") UUID a, @Param("b") UUID b);

    @Query("""
            select r from FriendRequest r where r.requesterId = :requester and r.targetId = :target
              and r.status = com.englishspeaking.platform.friends.FriendRequestStatus.DECLINED and r.respondedAt > :since
            """)
    List<FriendRequest> findDeclinedSince(@Param("requester") UUID requester, @Param("target") UUID target, @Param("since") Instant since);

    long countByRequesterIdAndCreatedAtAfter(UUID requesterId, Instant since);

    @Modifying
    @Query("delete from FriendRequest r where r.requesterId = :u or r.targetId = :u")
    int deleteAllFor(@Param("u") UUID u);
}
