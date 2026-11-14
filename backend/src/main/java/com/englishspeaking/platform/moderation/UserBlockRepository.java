package com.englishspeaking.platform.moderation;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface UserBlockRepository extends JpaRepository<UserBlock, UserBlock.Key> {
    @Query("select b.id.blockedId from UserBlock b where b.id.blockerId = :userId")
    List<UUID> findBlockedBy(@Param("userId") UUID userId);

    @Query("select b.id.blockerId from UserBlock b where b.id.blockedId = :userId")
    List<UUID> findBlockersOf(@Param("userId") UUID userId);

    /** Everyone this user blocked and everyone who blocked them, in one query (two sequential round trips before). */
    @Query(value = "select blocked_id from user_blocks where blocker_id = :userId union select blocker_id from user_blocks where blocked_id = :userId", nativeQuery = true)
    List<UUID> findEitherWay(@Param("userId") UUID userId);

    @Query("select b from UserBlock b where b.id.blockerId = :userId order by b.createdAt desc")
    List<UserBlock> listForBlocker(@Param("userId") UUID userId);
}
