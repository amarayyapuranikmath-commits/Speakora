package com.englishspeaking.platform;

import com.englishspeaking.platform.auth.AuthDtos.RegisterRequest;
import com.englishspeaking.platform.auth.AuthService;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.matching.MatchmakingStore;
import com.englishspeaking.platform.security.RateLimiter;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Where does the OTP email go? The real sign-up, forgot-password and resend code, the real mail service and a REAL SMTP conversation (GreenMail),
 * with the sender set to the project's own sending address. Every message must be addressed to the address the person entered, and none may be
 * addressed to the sender: MAIL_FROM decides the From header and nothing else. Also checks that wrong and expired codes are still refused.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {"app.mail-from=no-reply@example.com", "app.mail-async=false"})
class OtpRecipientIntegrationTest {
    private static final String URL = "jdbc:postgresql://localhost:5432/english_speaking_test";
    private static final String SENDER = "no-reply@example.com";
    private static String password;

    @RegisterExtension
    static final GreenMailExtension smtp = new GreenMailExtension(ServerSetupTest.SMTP);

    @TestConfiguration
    static class Mail {
        /** The real sender implementation, pointed at the in-process SMTP server. */
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
    /** The limits are tested in OtpResendIntegrationTest; here the same fixed addresses are used run after run, so the shared Redis counters must not matter. */
    @MockitoBean RateLimiter limiter;
    @Autowired AuthService auth;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    private final List<String> created = new ArrayList<>();

    @org.junit.jupiter.api.BeforeEach
    void withinEveryLimit() {
        when(limiter.tryAcquire(anyString(), anyInt(), any(java.time.Duration.class))).thenReturn(true);
    }

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

    private UUID signUp(String typed) {
        String stored = typed.trim().toLowerCase();
        created.add(stored);
        auth.register(new RegisterRequest(typed, "Passw0rdOK", "Recipient Test", LocalDate.of(1990, 1, 1)), "JUnit");
        return users.findByEmail(stored).orElseThrow().getId();
    }

    private MimeMessage last() {
        MimeMessage[] all = smtp.getReceivedMessages();
        assertThat(all).isNotEmpty();
        return all[all.length - 1];
    }

    private static String codeIn(MimeMessage m) {
        Matcher c = Pattern.compile("YOUR CODE: (\\d{6})").matcher(GreenMailUtil.getWholeMessage(m));
        assertThat(c.find()).as("a 6-digit code in the message").isTrue();
        return c.group(1);
    }

    /** The message is addressed To the entered address and to nobody else, and comes From "Speakora" at the configured sending address. */
    private void assertAddressedOnlyTo(MimeMessage m, String expected) throws Exception {
        assertThat(m.getAllRecipients()).hasSize(1);
        assertThat(((InternetAddress) m.getAllRecipients()[0]).getAddress()).isEqualToIgnoringCase(expected);
        assertThat(m.getRecipients(jakarta.mail.Message.RecipientType.BCC)).isNull();
        assertThat(m.getRecipients(jakarta.mail.Message.RecipientType.CC)).isNull();
        InternetAddress from = (InternetAddress) m.getFrom()[0];
        assertThat(from.getAddress()).isEqualToIgnoringCase(SENDER);
        assertThat(from.getPersonal()).isEqualTo("Speakora");
        assertThat(expected.toLowerCase()).isNotEqualTo(SENDER);
    }

    @Test
    void theSignUpOtpGoesToTheAddressThatWasEnteredAndNeverToTheSender() throws Exception {
        // different people, different providers, awkward spellings: all end up lower-cased and trimmed
        String[] typed = {"user@example.com", "  Anna.Smith@Other.Example  ", "joe+news@corp.example.org", "UPPER@UPPER.EXAMPLE"};
        for (String t : typed) {
            int before = smtp.getReceivedMessages().length;
            signUp(t);
            assertThat(smtp.getReceivedMessages()).hasSize(before + 1);
            MimeMessage m = last();
            assertAddressedOnlyTo(m, t.trim().toLowerCase());
            assertThat(m.getSubject()).isEqualTo("Verify your email for Speakora");
        }
        // Delivery is decided by the SMTP envelope (RCPT TO), not by headers: nothing may have been delivered for the sender's own domain mailbox.
        // The sender is on example.com; only the first address above is on example.com, and it must be that user, not the sender.
        assertThat(smtp.getReceivedMessagesForDomain("other.example")).hasSize(1);
        assertThat(smtp.getReceivedMessagesForDomain("corp.example.org")).hasSize(1);
        assertThat(smtp.getReceivedMessagesForDomain("upper.example")).hasSize(1);
        for (MimeMessage m : smtp.getReceivedMessagesForDomain("example.com")) {
            assertThat(((InternetAddress) m.getAllRecipients()[0]).getAddress()).isEqualTo("user@example.com");
        }
    }

    @Test
    void theForgotPasswordOtpGoesToTheRegisteredAddressWhateverTheCaseOrSpacesTyped() throws Exception {
        signUp("someone.else@other.example");
        int before = smtp.getReceivedMessages().length;
        auth.forgotPassword("  Someone.Else@OTHER.example ");
        assertThat(smtp.getReceivedMessages()).hasSize(before + 1);
        MimeMessage m = last();
        assertAddressedOnlyTo(m, "someone.else@other.example");
        assertThat(m.getSubject()).isEqualTo("Reset your Speakora password");
    }

    @Test
    void forgotPasswordForAnAddressWithNoAccountSendsNothingAtAll() {
        int before = smtp.getReceivedMessages().length;
        auth.forgotPassword("nobody.at.all@other.example");
        auth.forgotPassword(SENDER); // not even to the sender's own address: there is no account for it
        assertThat(smtp.getReceivedMessages()).hasSize(before);
    }

    @Test
    void aResendGoesToTheSameRegisteredAddressWithAFreshCode() throws Exception {
        UUID id = signUp("resend.me@other.example");
        String first = codeIn(last());
        // there is no waiting time between codes: ask again straight away
        int before = smtp.getReceivedMessages().length;
        auth.resendVerification(id);
        assertThat(smtp.getReceivedMessages()).hasSize(before + 1);
        MimeMessage m = last();
        assertAddressedOnlyTo(m, "resend.me@other.example");
        assertThat(codeIn(m)).isNotEqualTo(first);
    }

    @Test
    void aWrongOtpIsRefusedAndAnExpiredOtpIsRefusedEvenIfItIsTheRightCode() {
        UUID id = signUp("expiry@other.example");
        String code = codeIn(last());
        String wrong = code.equals("000000") ? "111111" : "000000";
        assertThatThrownBy(() -> auth.verifyEmailCode(id, wrong)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("INVALID_CODE"));
        // a code lives 30 minutes
        jdbc.update("update email_verification_tokens set created_at = created_at - interval '31 minutes' where user_id = ?", id);
        assertThatThrownBy(() -> auth.verifyEmailCode(id, code)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("INVALID_CODE"));
        assertThat(users.findById(id).orElseThrow().isEmailVerified()).isFalse();
    }

    @Test
    void aWrongOrExpiredResetOtpIsRefusedAndTheRightFreshOneWorks() {
        signUp("reset.expiry@other.example");
        auth.forgotPassword("reset.expiry@other.example");
        String code = codeIn(last());
        String wrong = code.equals("000000") ? "111111" : "000000";
        assertThatThrownBy(() -> auth.resetPasswordWithCode("reset.expiry@other.example", wrong, "NewPassw0rd1")).isInstanceOf(ApiException.class);
        jdbc.update("update password_reset_tokens set created_at = created_at - interval '31 minutes' where user_id = (select id from users where email = ?)", "reset.expiry@other.example");
        assertThatThrownBy(() -> auth.resetPasswordWithCode("reset.expiry@other.example", code, "NewPassw0rd1")).isInstanceOf(ApiException.class);
        // asking again sends a fresh code to the same address, and that one works
        auth.forgotPassword("reset.expiry@other.example");
        String fresh = codeIn(last());
        auth.resetPasswordWithCode("reset.expiry@other.example", fresh, "NewPassw0rd1");
    }
}
