package com.englishspeaking.platform.security;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.ConstructorBinding;

import java.util.Arrays;
import java.util.List;

@ConfigurationProperties(prefix = "app")
public record AppProperties(String name, String baseUrl, String corsAllowedOrigins, Jwt jwt, int refreshTtlDays,
                            boolean cookieSecure, Turn turn, String adminEmails, Coach coach) {

    /** Convenience for tests: no admins, coach disabled. */
    public AppProperties(String name, String baseUrl, String corsAllowedOrigins, Jwt jwt, int refreshTtlDays, boolean cookieSecure, Turn turn) {
        this(name, baseUrl, corsAllowedOrigins, jwt, refreshTtlDays, cookieSecure, turn, "", new Coach("", "claude-sonnet-5-5", "https://api.anthropic.com", 20));
    }

    @ConstructorBinding
    public AppProperties {}

    /** Secrets are redacted in toString so a stray log line or exception message can never print them. */
    public record Jwt(String secret, int accessTtlMinutes) {
        @Override public String toString() { return "Jwt[secret=***, accessTtlMinutes=" + accessTtlMinutes + "]"; }
    }

    /**
     * TURN comes from Turnix: the backend exchanges {@code apiToken} for short-lived ICE credentials, so no TURN secret exists
     * here and the token never reaches a client. {@code forceRelay} makes clients use TURN only. {@code trustedProxies} is a
     * comma-separated list of IPs/CIDRs of reverse proxies whose X-Forwarded-For is believed (empty: believe none).
     */
    public record Turn(String apiToken, String apiUrl, boolean forceRelay, String trustedProxies) {
        public static final String DEFAULT_API_URL = "https://turnix.io/api/v1/credentials/ice";

        /** No token, defaults elsewhere: convenience for tests. */
        public Turn() { this("", DEFAULT_API_URL, false, ""); }

        public boolean configured() { return apiToken != null && !apiToken.isBlank(); }

        @Override public String toString() { return "Turn[apiToken=" + (configured() ? "***" : "<unset>") + ", apiUrl=" + apiUrl + ", forceRelay=" + forceRelay + ", trustedProxies=" + trustedProxies + "]"; }

        @ConstructorBinding
        public Turn {}
    }

    public record Coach(String apiKey, String model, String baseUrl, int dailyLimit) {
        public boolean configured() { return apiKey != null && !apiKey.isBlank(); }

        @Override public String toString() { return "Coach[apiKey=" + (configured() ? "***" : "<unset>") + ", model=" + model + ", baseUrl=" + baseUrl + ", dailyLimit=" + dailyLimit + "]"; }
    }

    public List<String> corsOrigins() {
        return Arrays.stream(corsAllowedOrigins.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    public List<String> adminEmailList() {
        return adminEmails == null ? List.of() : Arrays.stream(adminEmails.split(",")).map(s -> s.trim().toLowerCase()).filter(s -> !s.isEmpty()).toList();
    }
}
