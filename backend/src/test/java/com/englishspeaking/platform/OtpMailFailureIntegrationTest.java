package com.englishspeaking.platform;

import com.englishspeaking.platform.auth.AuthDtos.AuthResult;
import com.englishspeaking.platform.auth.AuthDtos.RegisterRequest;
import com.englishspeaking.platform.auth.AuthService;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.matching.MatchmakingStore;
import com.englishspeaking.platform.user.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * When the mail server cannot be reached (here: nothing is listening), the person is told so clearly instead of being left waiting for a code that
 * will never come, and the real service, database and Redis behave correctly around the failure.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {"app.mail-from=no-reply@example.com", "app.mail-async=false"})
class OtpMailFailureIntegrationTest {
    private static final String URL = "jdbc:postgresql://localhost:5432/english_speaking_test";
    private static String password;

    @TestConfiguration
    static class Mail {
        /** Nothing listens on port 1: every send fails to connect. */
        @Bean
        JavaMailSender javaMailSender() {
            JavaMailSenderImpl sender = new JavaMailSenderImpl();
            sender.setHost("127.0.0.1");
            sender.setPort(1);
            sender.setDefaultEncoding("UTF-8");
            return sender;
        }
    }

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
    @Autowired AuthService auth;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    private final List<String> created = new ArrayList<>();

    @AfterEach
    void cleanUp() {
        for (String email : created) {
            users.findByEmail(email).ifPresent(u -> {
                jdbc.update("delete from email_verification_tokens where user_id = ?", u.getId());
                jdbc.update("delete from password_reset_tokens where user_id = ?", u.getId());
                jdbc.update("delete from refresh_tokens where user_id = ?", u.getId());
                jdbc.update("delete from users where id = ?", u.getId());
            });
        }
    }

    private String address(String name) { return name + "." + UUID.randomUUID().toString().substring(0, 8) + "@failure.example"; }

    @Test
    void signingUpStillWorksButTheFirstEmailFailureIsStatedClearly() {
        String email = address("signup");
        created.add(email);
        AuthResult result = auth.register(new RegisterRequest(email, "Passw0rdOK", "Failure Test", LocalDate.of(1990, 1, 1)), "JUnit");
        assertThat(users.findByEmail(email)).as("the account exists").isPresent();
        assertThat(result.verificationEmailProblem()).isEqualTo("We could not reach the email service. Please try again in a moment.");
    }

    @Test
    void aResendThatCannotBeSentSaysSoAndForgottenPasswordDoesToo() {
        String email = address("resend");
        created.add(email);
        auth.register(new RegisterRequest(email, "Passw0rdOK", "Failure Test", LocalDate.of(1990, 1, 1)), "JUnit");
        UUID id = users.findByEmail(email).orElseThrow().getId();
        assertThatThrownBy(() -> auth.resendVerification(id)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.status().value()).isEqualTo(503);
            assertThat(e.code()).isEqualTo("EMAIL_SEND_FAILED");
            assertThat(e.getMessage()).isEqualTo("We could not reach the email service. Please try again in a moment.");
        });
        assertThatThrownBy(() -> auth.forgotPassword(email)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("EMAIL_SEND_FAILED"));
        // a failed email leaves no half-made code behind: only the one made at sign-up exists
        assertThat(jdbc.queryForObject("select count(*) from password_reset_tokens where user_id = ?", Integer.class, id)).isZero();
    }
}
