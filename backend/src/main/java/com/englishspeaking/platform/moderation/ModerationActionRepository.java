package com.englishspeaking.platform.moderation;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ModerationActionRepository extends JpaRepository<ModerationAction, UUID> {
    List<ModerationAction> findTop10ByTargetUserIdOrderByCreatedAtDesc(UUID targetUserId);
}
