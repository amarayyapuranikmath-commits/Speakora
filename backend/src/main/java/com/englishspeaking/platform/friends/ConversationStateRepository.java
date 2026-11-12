package com.englishspeaking.platform.friends;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

public interface ConversationStateRepository extends JpaRepository<ConversationState, ConversationState.Key> {
    @Modifying
    @Query("delete from ConversationState s where s.id.userId = :u or s.id.otherId = :u")
    int deleteAllFor(@Param("u") UUID u);
}
