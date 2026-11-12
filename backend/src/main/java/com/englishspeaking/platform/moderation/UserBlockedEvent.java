package com.englishspeaking.platform.moderation;

import java.util.UUID;

/** Published when someone blocks someone else, so open call requests between them can be withdrawn. */
public record UserBlockedEvent(UUID blockerId, UUID blockedId) {}
