package com.englishspeaking.platform;

import com.englishspeaking.platform.auth.AuthDtos.RegisterRequest;
import com.englishspeaking.platform.auth.AuthService;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.matching.MatchmakingStore;
import com.englishspeaking.platform.notification.MailService;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.LocalDate;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

/**
 * Email and reset codes against the real database, with REAL commits (this class is deliberately not @Transactional). A wrong guess
 * throws, and the failed attempt has to survive that: when it was rolled back with the exception, the limit of five guesses never took
 * effect. Mocked unit tests and test-managed transactions cannot see that, which is how the bug reached a live check.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AuthCodeIntegrationTest {
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
    @Autowired AuthService auth;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    private final String email = "authcode." + UUID.randomUUID() + "@it.example.com";

    @AfterEach
    void cleanUp() {
        users.findByEmail(email).ifPresent(u -> {
            jdbc.update("delete from email_verification_tokens where user_id = ?", u.getId());
            jdbc.update("delete from password_reset_tokens where user_id = ?", u.getId());
            jdbc.update("delete from refresh_tokens where user_id = ?", u.getId());
            jdbc.update("delete from users where id = ?", u.getId());
        });
    }

    private UUID signUp() {
        auth.register(new RegisterRequest(email, "Passw0rdOK", "Code Test", LocalDate.of(1990, 1, 1)), "JUnit");
        return users.findByEmail(email).orElseThrow().getId();
    }

    private String lastVerificationCode() {
        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        verify(mail).sendVerificationEmail(eq(email), anyString(), code.capture());
        return code.getValue();
    }

    private static String wrongCodeFor(String code) { return code.equals("000000") ? "111111" : "000000"; }

    @Test
    void fiveWrongVerificationCodesSpendTheCodeEvenThoughEachGuessThrows() {
        UUID id = signUp();
        String code = lastVerificationCode();
        for (int i = 1; i <= 4; i++) {
            assertThatThrownBy(() -> auth.verifyEmailCode(id, wrongCodeFor(code))).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("not right"));
        }
        assertThatThrownBy(() -> auth.verifyEmailCode(id, wrongCodeFor(code))).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("Too many"));
        assertThatThrownBy(() -> auth.verifyEmailCode(id, code)).as("the right code no longer works").isInstanceOf(ApiException.class);
        assertThat(users.findById(id).orElseThrow().isEmailVerified()).isFalse();
    }

    @Test
    void theRightVerificationCodeIsRememberedAfterEarlierMistakes() {
        UUID id = signUp();
        String code = lastVerificationCode();
        assertThatThrownBy(() -> auth.verifyEmailCode(id, wrongCodeFor(code))).isInstanceOf(ApiException.class);
        auth.verifyEmailCode(id, code);
        assertThat(users.findById(id).orElseThrow().isEmailVerified()).isTrue();
    }

    @Test
    void fiveWrongResetCodesSpendTheCodeAndThePasswordNeverChanges() {
        signUp();
        auth.forgotPassword(email);
        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        verify(mail).sendPasswordResetEmail(eq(email), anyString(), code.capture());
        String right = code.getValue();
        String hashBefore = users.findByEmail(email).orElseThrow().getPasswordHash();
        for (int i = 1; i <= 5; i++) {
            assertThatThrownBy(() -> auth.resetPasswordWithCode(email, wrongCodeFor(right), "BrandNewPass1")).isInstanceOf(ApiException.class);
        }
        assertThatThrownBy(() -> auth.resetPasswordWithCode(email, right, "BrandNewPass1")).as("the right code is spent too").isInstanceOf(ApiException.class);
        User after = users.findByEmail(email).orElseThrow();
        assertThat(after.getPasswordHash()).isEqualTo(hashBefore);
    }

    @Test
    void aGoodResetCodeChangesThePasswordForReal() {
        signUp();
        auth.forgotPassword(email);
        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        verify(mail).sendPasswordResetEmail(eq(email), anyString(), code.capture());
        String hashBefore = users.findByEmail(email).orElseThrow().getPasswordHash();
        auth.resetPasswordWithCode(email, code.getValue(), "BrandNewPass1");
        assertThat(users.findByEmail(email).orElseThrow().getPasswordHash()).isNotEqualTo(hashBefore);
    }
}
