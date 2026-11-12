package com.englishspeaking.platform.friends;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface FriendshipRepository extends JpaRepository<Friendship, Friendship.Key> {
    @Query("select f from Friendship f where f.id.userA = :u or f.id.userB = :u")
    List<Friendship> findAllFor(@Param("u") UUID u);

    @Modifying
    @Query("delete from Friendship f where f.id.userA = :u or f.id.userB = :u")
    int deleteAllFor(@Param("u") UUID u);
}
