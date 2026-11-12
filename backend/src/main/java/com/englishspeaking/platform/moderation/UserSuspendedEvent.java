package com.englishspeaking.platform.moderation;

import java.util.UUID;

/** Published when a moderator suspends an account, so the queue and signalling socket can be cleaned up. */
public record UserSuspendedEvent(UUID userId) {}
