package com.englishspeaking.platform.security;

import java.util.UUID;

/** Authenticated caller, derived from a verified access token. */
public record AuthPrincipal(UUID userId, String role) {}
