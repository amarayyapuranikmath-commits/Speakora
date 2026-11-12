package com.englishspeaking.platform.feedback;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface CallFeedbackRepository extends JpaRepository<CallFeedback, UUID> {
    boolean existsByCallIdAndAuthorId(UUID callId, UUID authorId);

    List<CallFeedback> findByAuthorIdAndCallIdIn(UUID authorId, Collection<UUID> callIds);
}
