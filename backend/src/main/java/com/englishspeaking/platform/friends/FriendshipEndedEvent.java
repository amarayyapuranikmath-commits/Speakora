package com.englishspeaking.platform.friends;

import java.util.UUID;

/** Published when a friendship ends (removed, or one person blocked the other) so open call invites can be withdrawn. */
public record FriendshipEndedEvent(UUID a, UUID b) {}
