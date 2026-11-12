package com.englishspeaking.platform.security;

import jakarta.annotation.PostConstruct;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * With the "prod" profile the app refuses to start on an insecure configuration instead of quietly running with it.
 * (Redis/DB/SMTP availability is reported by health and the admin System page, not here.)
 */
@Component
@Profile("prod")
public class ProductionSafetyCheck {
    private final AppProperties props;
    private final String mailFrom;

    public ProductionSafetyCheck(AppProperties props, @org.springframework.beans.factory.annotation.Value("${app.mail-from:}") String mailFrom) {
        this.props = props;
        this.mailFrom = mailFrom;
    }

    @PostConstruct
    void verify() {
        List<String> problems = problems(props);
        // Verification and password-reset codes are sent from this address: a placeholder means nobody can verify or reset.
        if (com.englishspeaking.platform.notification.MailService.isPlaceholderSender(mailFrom)) problems.add("MAIL_FROM must be a real sender address on a domain verified with your mail provider (not empty and not an example.com address)");
        if (!problems.isEmpty()) {
            throw new IllegalStateException("Refusing to start with an unsafe production configuration:\n - " + String.join("\n - ", problems));
        }
    }

    static List<String> problems(AppProperties p) {
        List<String> problems = new ArrayList<>();
        if (!p.cookieSecure()) problems.add("COOKIE_SECURE must be true");
        if (!p.baseUrl().toLowerCase().startsWith("https://")) problems.add("APP_BASE_URL must be an https:// URL");
        for (String origin : p.corsOrigins()) {
            if (!origin.toLowerCase().startsWith("https://")) problems.add("CORS_ALLOWED_ORIGINS must be https only, found: " + origin);
            if (origin.contains("localhost") || origin.contains("127.0.0.1")) problems.add("CORS_ALLOWED_ORIGINS must not include localhost: " + origin);
        }
        String secret = p.jwt().secret();
        if (secret == null || secret.length() < 48) problems.add("JWT_SECRET must be at least 48 characters of random data");
        if (secret != null && secret.toLowerCase().contains("change-me")) problems.add("JWT_SECRET is still a placeholder");
        if (p.turn() == null || !p.turn().configured()) problems.add("TURNIX_API_TOKEN must be set: voice calls cannot get TURN credentials without it");
        if (p.turn() != null && (p.turn().apiUrl() == null || !p.turn().apiUrl().toLowerCase().startsWith("https://"))) problems.add("TURNIX_API_URL must be an https:// URL (the token is sent to it)");
        return problems;
    }
}
