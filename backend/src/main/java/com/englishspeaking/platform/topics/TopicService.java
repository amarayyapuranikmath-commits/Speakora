package com.englishspeaking.platform.topics;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Service
@Transactional(readOnly = true)
public class TopicService {
    public record TopicDto(String slug, String name, String description, List<String> prompts) {
        static TopicDto from(Topic t) { return new TopicDto(t.getSlug(), t.getName(), t.getDescription(), List.copyOf(t.getPrompts())); }
    }

    private final TopicRepository topics;

    public TopicService(TopicRepository topics) { this.topics = topics; }

    public List<TopicDto> listActive() {
        return topics.findByActiveTrueOrderBySortOrderAsc().stream().map(TopicDto::from).toList();
    }

    public Optional<Topic> findActive(String slug) { return topics.findBySlugAndActiveTrue(slug); }

    public boolean isValidSlug(String slug) { return topics.findBySlugAndActiveTrue(slug).isPresent(); }
}
