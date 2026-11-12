package com.englishspeaking.platform.matching;

import java.util.Set;
import java.util.UUID;

/** A user waiting for a partner. {@code level} is the CEFR ordinal + 1, or 0 when unknown. */
public record QueueEntry(UUID userId, int level, Set<String> interests, String topicSlug, boolean similarLevelOnly,
                         long enqueuedAtMillis) {}
