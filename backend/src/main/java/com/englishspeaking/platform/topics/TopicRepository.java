package com.englishspeaking.platform.topics;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TopicRepository extends JpaRepository<Topic, UUID> {
    List<Topic> findByActiveTrueOrderBySortOrderAsc();

    Optional<Topic> findBySlugAndActiveTrue(String slug);
}
