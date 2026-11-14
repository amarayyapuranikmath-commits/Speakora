package com.englishspeaking.platform.websocket;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class WsOriginTest {
    private static final List<String> SITE = List.of("https://speakora-opal.vercel.app");

    @Test
    void theServersOwnPublicOriginIsAllowedSoTheAndroidAppIsNotRefusedBehindATlsProxy() {
        assertThat(WebSocketConfig.allowedOrigins(SITE, "", "https://speakora-6mkd.onrender.com"))
                .containsExactly("https://speakora-opal.vercel.app", "https://speakora-6mkd.onrender.com");
    }

    @Test
    void anExplicitPublicWsUrlGivesTheOriginAndATrailingSlashOrPathDoesNotMatter() {
        assertThat(WebSocketConfig.ownOrigin("wss://api.speak.example/ws/signaling", "")).isEqualTo("https://api.speak.example");
        assertThat(WebSocketConfig.ownOrigin("", "https://speakora-6mkd.onrender.com/")).isEqualTo("https://speakora-6mkd.onrender.com");
        assertThat(WebSocketConfig.ownOrigin("ws://localhost:8080/ws/signaling", "")).isEqualTo("http://localhost:8080");
    }

    @Test
    void nothingIsAddedWhenTheServerDoesNotKnowItsAddressAndOtherSitesStayRefused() {
        assertThat(WebSocketConfig.allowedOrigins(SITE, "", "")).containsExactlyElementsOf(SITE);
        assertThat(WebSocketConfig.allowedOrigins(SITE, null, "http://insecure.example")).containsExactlyElementsOf(SITE);
        assertThat(WebSocketConfig.allowedOrigins(SITE, "", "https://speakora-6mkd.onrender.com")).doesNotContain("https://evil.example");
    }

    @Test
    void aDuplicateOriginIsListedOnce() {
        assertThat(WebSocketConfig.allowedOrigins(List.of("https://speakora-6mkd.onrender.com"), "", "https://speakora-6mkd.onrender.com")).hasSize(1);
    }
}
