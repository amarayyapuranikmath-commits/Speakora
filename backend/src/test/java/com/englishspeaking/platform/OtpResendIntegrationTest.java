package com.englishspeaking.platform;

import com.englishspeaking.platform.auth.AuthDtos.RegisterRequest;
import com.englishspeaking.platform.auth.AuthService;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.matching.MatchmakingStore;
import com.englishspeaking.platform.user.UserRepository;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetupTest;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
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
 * Resending a code: no waiting time, the newest email is the only one that works, and the limits that remain (per account, per address) are explained.
 * Real database, real Redis and a real SMTP conversation; addresses are unique per run so the Redis counters of earlier runs cannot matter.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {"app.mail-from=no-reply@example.com", "app.mail-async=false", "app.base-url=https://resend.example"}) // a deployed address, so the emails carry their link
class OtpResendIntegrationTest {
    private static final String URL = "jdbc:postgresql://localhost:5432/english_speaking_test";
    private static String password;

    @RegisterExtension
    static final GreenMailExtension smtp = new GreenMailExtension(ServerSetupTest.SMTP);

    @TestConfiguration
    static class Mail {
        @Bean
        JavaMailSender javaMailSender() {
            JavaMailSenderImpl sender = new JavaMailSenderImpl();
            sender.setHost("127.0.0.1");
            sender.setPort(ServerSetupTest.SMTP.getPort());
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

    /** A unique address for this test, so counters kept in Redis by earlier runs cannot affect it. */
    private String address(String name) { return name + "." + UUID.randomUUID().toString().substring(0, 8) + "@resend.example"; }

    private UUID signUp(String email) {
        created.add(email);
        auth.register(new RegisterRequest(email, "Passw0rdOK", "Resend Test", LocalDate.of(1990, 1, 1)), "JUnit");
        return users.findByEmail(email).orElseThrow().getId();
    }

    private MimeMessage[] mails(String to) {
        return java.util.Arrays.stream(smtp.getReceivedMessages()).filter(m -> {
            try { return ((InternetAddress) m.getAllRecipients()[0]).getAddress().equalsIgnoreCase(to); } catch (Exception e) { return false; }
        }).toArray(MimeMessage[]::new);
    }

    private static String codeIn(MimeMessage m) {
        Matcher c = Pattern.compile("YOUR CODE: (\\d{6})").matcher(GreenMailUtil.getWholeMessage(m));
        assertThat(c.find()).isTrue();
        return c.group(1);
    }

    private static void assertRefused(Runnable r) {
        assertThatThrownBy(r::run).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("INVALID_CODE"));
    }

    @Test
    void resendingSignUpSendsAFreshCodeImmediatelyAndOnlyTheNewestWorks() {
        String email = address("signup");
        UUID id = signUp(email);
        String first = codeIn(mails(email)[0]);

        auth.resendVerification(id); // straight away: no waiting time
        MimeMessage[] sent = mails(email);
        assertThat(sent).as("the signup email and the resent email, both to the same address").hasSize(2);
        String second = codeIn(sent[1]);
        assertThat(second).isNotEqualTo(first);

        assertRefused(() -> auth.verifyEmailCode(id, first)); // the earlier code is dead
        auth.verifyEmailCode(id, second); // the newest works
        assertThat(users.findById(id).orElseThrow().isEmailVerified()).isTrue();
    }

    @Test
    void aResendedLinkAlsoSupersedesTheEarlierLink() {
        String email = address("link");
        UUID id = signUp(email);
        String firstEmail = GreenMailUtil.getWholeMessage(mails(email)[0]);
        Matcher link = Pattern.compile("verify-email\\?token=([A-Za-z0-9_-]+)").matcher(firstEmail);
        assertThat(link.find()).isTrue();
        auth.resendVerification(id);
        assertThatThrownBy(() -> auth.verifyEmail(link.group(1))).isInstanceOf(ApiException.class); // the first email's link no longer works
    }

    @Test
    void askingForAnotherResetCodeSendsItImmediatelyToTheSameAddressAndOnlyTheNewestWorks() {
        String email = address("reset");
        signUp(email);
        auth.forgotPassword(email);
        String first = codeIn(mails(email)[1]);
        auth.forgotPassword(email); // again, straight away
        MimeMessage[] sent = mails(email);
        assertThat(sent).hasSize(3); // sign-up, reset, reset again
        String second = codeIn(sent[2]);
        assertThat(second).isNotEqualTo(first);

        assertThatThrownBy(() -> auth.resetPasswordWithCode(email, first, "NewPassw0rd1")).isInstanceOf(ApiException.class);
        auth.resetPasswordWithCode(email, second, "NewPassw0rd1");
        assertThatThrownBy(() -> auth.resetPasswordWithCode(email, second, "Another0ne11")).as("single use").isInstanceOf(ApiException.class);
    }

    @Test
    void theLimitPerAccountIsEnforcedWithAClearMessageAndStopsSendingEmails() {
        String email = address("limit");
        UUID id = signUp(email);
        for (int i = 0; i < AuthService.MAX_CODES_PER_WINDOW; i++) auth.resendVerification(id); // all allowed, with no waiting in between
        int before = mails(email).length;
        assertThat(before).isEqualTo(1 + AuthService.MAX_CODES_PER_WINDOW);
        assertThatThrownBy(() -> auth.resendVerification(id)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.code()).isEqualTo("TOO_MANY_CODES");
            assertThat(e.status().value()).isEqualTo(429);
            assertThat(e.retryAfterSeconds()).isEqualTo(900);
            assertThat(e.getMessage()).contains("about 15 minutes");
        });
        assertThat(mails(email)).as("a refused request sends nothing").hasSize(before);
    }

    @Test
    void theLimitForForgottenPasswordIsPerAddressAndIdenticalWhetherOrNotTheAddressHasAnAccount() {
        String real = address("real");
        String ghost = address("ghost");
        signUp(real);
        for (int i = 0; i < AuthService.MAX_CODES_PER_WINDOW; i++) {
            auth.forgotPassword(real);
            auth.forgotPassword(ghost); // no account: silently nothing, but counted the same way
        }
        for (String who : new String[] {real, ghost}) {
            assertThatThrownBy(() -> auth.forgotPassword(who)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("TOO_MANY_CODES"));
        }
        assertThat(mails(ghost)).isEmpty();
    }
}
