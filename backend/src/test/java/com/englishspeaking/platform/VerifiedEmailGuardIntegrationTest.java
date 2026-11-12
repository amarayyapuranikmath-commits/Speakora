package com.englishspeaking.platform;

import com.englishspeaking.platform.matching.MatchmakingStore;
import com.englishspeaking.platform.notification.MailService;
import com.englishspeaking.platform.user.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

/**
 * With REQUIRE_VERIFIED_EMAIL on (production's setting), an account that has not verified its email can sign in and verify, learn and use the
 * tutor, but cannot reach other people (friends, matching and calls); after the right code it can. Real HTTP, real database, real commits.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "app.require-verified-email=true")
class VerifiedEmailGuardIntegrationTest {
    private static final String URL = "jdbc:postgresql://localhost:5432/english_speaking_test";
    private static String password;

    @BeforeAll
    static void requireTestDatabase() {
        try {
            Matcher m = Pattern.compile("(?m)^DB_PASSWORD=([^\\r\\n]*)$").matcher(Files.readString(Path.of("../.env")));
            Assumptions.assumeTrue(m.find(), "no DB_PASSWORD in ../.env");
            password = m.group(1).trim();
            try (var c = DriverManager.getConnection(URL, "esp_app", password)) { c.isValid(2); }
        } catch (Exception e) {
            Assumptions.abort("PostgreSQL test database not reachable: " + e.getClass().getSimpleName());
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> URL);
        registry.add("spring.datasource.username", () -> "esp_app");
        registry.add("spring.datasource.password", () -> password);
    }

    @MockitoBean MatchmakingStore store;
    @MockitoBean MailService mail;
    @Autowired TestRestTemplate http;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    private final String email = "guard." + UUID.randomUUID() + "@it.example.com";

    @AfterEach
    void cleanUp() {
        users.findByEmail(email).ifPresent(u -> {
            jdbc.update("delete from email_verification_tokens where user_id = ?", u.getId());
            jdbc.update("delete from refresh_tokens where user_id = ?", u.getId());
            jdbc.update("delete from users where id = ?", u.getId());
        });
    }

    private HttpHeaders headers(String token) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.set("X-Client-Type", "mobile");
        if (token != null) h.setBearerAuth(token);
        return h;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> call(HttpMethod method, String path, String token, Object body) {
        var res = http.exchange(path, method, new HttpEntity<>(body, headers(token)), Map.class);
        Map<String, Object> out = new java.util.HashMap<>(res.getBody() == null ? Map.of() : res.getBody());
        out.put("_status", res.getStatusCode().value());
        return out;
    }

    @Test
    void anUnverifiedAccountCannotReachOtherPeopleUntilItEntersTheCode() {
        Map<String, Object> reg = call(HttpMethod.POST, "/api/auth/register", null,
                Map.of("email", email, "password", "Passw0rdOK", "displayName", "Guard Test", "dateOfBirth", "1990-05-01"));
        assertThat(reg.get("_status")).isEqualTo(201);
        String token = (String) reg.get("accessToken");
        assertThat(token).isNotBlank();

        // Other people: refused, with a code the apps can act on.
        for (String[] r : new String[][] {{"GET", "/api/friends"}, {"POST", "/api/ws/ticket"}}) {
            Map<String, Object> blocked = call(HttpMethod.valueOf(r[0]), r[1], token, null);
            assertThat(blocked.get("_status")).as(r[1]).isEqualTo(403);
            assertThat(blocked.get("code")).as(r[1]).isEqualTo("EMAIL_NOT_VERIFIED");
        }
        // Everything a new user needs to finish signing up and look around stays open.
        assertThat(call(HttpMethod.GET, "/api/auth/me", token, null).get("_status")).isIn(200, 404);
        assertThat(call(HttpMethod.GET, "/api/coach/preferences", token, null).get("_status")).isEqualTo(200);
        assertThat(call(HttpMethod.GET, "/api/learn/progress", token, null).get("_status")).isEqualTo(200);

        // A wrong code does not verify; the right one does, once.
        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        verify(mail).sendVerificationEmail(eq(email), anyString(), code.capture());
        String wrong = code.getValue().equals("000000") ? "111111" : "000000";
        assertThat(call(HttpMethod.POST, "/api/auth/verify-email-code", token, Map.of("code", wrong)).get("_status")).isEqualTo(400);
        assertThat(call(HttpMethod.GET, "/api/friends", token, null).get("_status")).isEqualTo(403);
        assertThat(call(HttpMethod.POST, "/api/auth/verify-email-code", token, Map.of("code", code.getValue())).get("_status")).isEqualTo(204);
        assertThat(call(HttpMethod.GET, "/api/friends", token, null).get("_status")).isEqualTo(200);
        assertThat(call(HttpMethod.POST, "/api/auth/verify-email-code", token, Map.of("code", code.getValue())).get("_status")).isEqualTo(400); // one use only
    }
}
