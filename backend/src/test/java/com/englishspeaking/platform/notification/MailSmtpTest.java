package com.englishspeaking.platform.notification;

import com.englishspeaking.platform.TestSupport;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.ServerSetupTest;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Sends through a REAL SMTP conversation (GreenMail runs an actual SMTP server on a local port). */
class MailSmtpTest {
    @RegisterExtension
    static final GreenMailExtension smtp = new GreenMailExtension(ServerSetupTest.SMTP);

    private MailService serviceFor(JavaMailSenderImpl sender) {
        @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(sender);
        return new MailService(provider, TestSupport.props(), "no-reply@speak.example");
    }

    private JavaMailSenderImpl plainSender() { return MailConfig.build("127.0.0.1", smtp.getSmtp().getPort(), "", "", false); }

    private MimeMessage only() {
        assertThat(smtp.getReceivedMessages()).hasSize(1);
        return smtp.getReceivedMessages()[0];
    }

    /** Collects the text/plain and text/html leaves of a (possibly nested) multipart message. */
    private static java.util.Map<String, String> bodies(jakarta.mail.Part part) throws Exception {
        java.util.Map<String, String> out = new java.util.HashMap<>();
        if (part.isMimeType("multipart/*")) {
            jakarta.mail.Multipart mp = (jakarta.mail.Multipart) part.getContent();
            for (int i = 0; i < mp.getCount(); i++) out.putAll(bodies(mp.getBodyPart(i)));
        } else if (part.isMimeType("text/plain")) out.put("text", (String) part.getContent());
        else if (part.isMimeType("text/html")) out.put("html", (String) part.getContent());
        return out;
    }

    private MailService withHtml(MailService s) { s.html = true; return s; }

    @Test
    void verificationEmailIsDeliveredAsHtmlAndPlainTextFromTheApplicationNameWhenHtmlIsOn() throws Exception {
        withHtml(serviceFor(plainSender())).sendVerificationEmail("ana@example.com", "tok123", "482913");
        MimeMessage m = only();
        assertThat(m.getSubject()).isEqualTo("Verify your email for " + TestSupport.props().name());
        // The sender shows the application's name with the configured address, never a person or a server.
        assertThat(((jakarta.mail.internet.InternetAddress) m.getFrom()[0]).getPersonal()).isEqualTo(TestSupport.props().name());
        assertThat(((jakarta.mail.internet.InternetAddress) m.getFrom()[0]).getAddress()).isEqualTo("no-reply@speak.example");
        assertThat(m.getAllRecipients()[0].toString()).isEqualTo("ana@example.com");
        var b = bodies(m);
        assertThat(b).containsKeys("text", "html");
        for (String body : b.values()) {
            assertThat(body).contains("482913").contains("30 minutes").doesNotContain("localhost"); // no link nobody can open
        }
        assertThat(b.get("text")).contains("YOUR CODE: 482913").doesNotContain("<");
        assertThat(b.get("html")).contains("<!DOCTYPE html>").contains("viewport").contains("max-width:480px").doesNotContain("display:none");
        // one flat multipart/alternative with exactly two parts: no mixed / related wrappers
        assertThat(m.getContentType()).startsWith("multipart/alternative");
        assertThat(((jakarta.mail.Multipart) m.getContent()).getCount()).isEqualTo(2);
    }

    @Test
    void byDefaultACodeEmailIsOneSimplePlainTextMessageFromTheApplicationNameWithTheCodeAndNothingHidden() throws Exception {
        serviceFor(plainSender()).sendVerificationEmail("ana@example.com", "tok123", "482913");
        MimeMessage m = only();
        assertThat(m.getContentType()).startsWith("text/plain");           // a single part, like a plain SimpleMailMessage
        String body = (String) m.getContent();
        assertThat(body).contains("YOUR CODE: 482913").contains("30 minutes").contains("Never share this code").doesNotContain("<").doesNotContain("display:none");
        assertThat(((jakarta.mail.internet.InternetAddress) m.getFrom()[0]).getPersonal()).isEqualTo(TestSupport.props().name());
        assertThat(m.getHeader("Auto-Submitted")[0]).isEqualTo("auto-generated");
    }

    @Test
    void aRealEmailSentWhileTheAppRunsOnALocalAddressCarriesNoLinkToLocalhost() throws Exception {
        MailService svc = serviceFor(plainSender());
        svc.sendVerificationEmail("ana@example.com", "tok123", "482913");
        svc.sendPasswordResetEmail("ana@example.com", "reset456", "190377");
        for (MimeMessage m : smtp.getReceivedMessages()) {
            String body = (String) m.getContent();
            assertThat(body).doesNotContain("localhost").doesNotContain("http://").doesNotContain("token=");
            assertThat(body).containsPattern("YOUR CODE: \\d{6}");
        }
    }

    private MailService deployed() {
        var props = new com.englishspeaking.platform.security.AppProperties("Test App", "https://speak.example.com", "https://speak.example.com", new com.englishspeaking.platform.security.AppProperties.Jwt("x".repeat(32), 15), 30, true,
                new com.englishspeaking.platform.security.AppProperties.Turn(), "", new com.englishspeaking.platform.security.AppProperties.Coach("", "m", "u", 20));
        @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(plainSender());
        return new MailService(provider, props, "no-reply@speak.example");
    }

    @Test
    void aDeployedServerIncludesTheRealLinkAsWell() throws Exception {
        deployed().sendVerificationEmail("ana@example.com", "tok123", "482913");
        String body = (String) only().getContent();
        assertThat(body).contains("https://speak.example.com/verify-email?token=tok123").contains("YOUR CODE: 482913");
    }

    @Test
    void passwordResetEmailCarriesASingleUseCodeAndLinkAndNoPassword() throws Exception {
        deployed().sendPasswordResetEmail("ana@example.com", "reset456", "190377");
        MimeMessage m = only();
        assertThat(m.getSubject()).isEqualTo("Reset your " + TestSupport.props().name() + " password");
        for (String body : bodies(m).values()) {
            assertThat(body).contains("190377").contains("https://speak.example.com/reset-password?token=reset456").contains("60 minutes").contains("30 minutes").doesNotContainIgnoringCase("password is").doesNotContainIgnoringCase("temporary password");
        }
    }

    @Test
    void reminderEmailHasAnUnsubscribeHeaderAndAGreeting() throws Exception {
        withHtml(serviceFor(plainSender())).sendReminderEmail("ana@example.com", "Ana");
        MimeMessage m = only();
        assertThat(m.getHeader("List-Unsubscribe")[0]).isEqualTo("<http://localhost:5173/app/settings>");
        var b = bodies(m);
        assertThat(b.get("text")).contains("Hi Ana,").contains("/app/talk").contains("turn them off");
        assertThat(b.get("html")).contains("Hi Ana,");
    }

    @Test
    void nonAsciiNamesSurviveTheTrip() throws Exception {
        withHtml(serviceFor(plainSender())).sendReminderEmail("ana@example.com", "José Ñandú");
        var b = bodies(only());
        assertThat(b.get("text")).contains("José Ñandú");
        assertThat(b.get("html")).contains("José Ñandú");
    }

    @Test
    void aSenderConfiguredWithSomeoneElsesNameStillShowsTheApplicationName() throws Exception {
        @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(plainSender());
        new MailService(provider, TestSupport.props(), "Some Developer <dev@speak.example>").sendVerificationEmail("ana@example.com", "t", "123456");
        var from = (jakarta.mail.internet.InternetAddress) only().getFrom()[0];
        assertThat(from.getPersonal()).isEqualTo(TestSupport.props().name());
        assertThat(from.getAddress()).isEqualTo("dev@speak.example");
    }

    // --- failures: what is retried and what is not ------------------------------------------------------------------------------

    /** A sender that fails the first {@code failures} times with the given error, then accepts the mail. */
    private static final class Flaky extends JavaMailSenderImpl {
        int calls;
        final int failures;
        final java.util.function.Supplier<RuntimeException> error;
        Flaky(int failures, java.util.function.Supplier<RuntimeException> error) { this.failures = failures; this.error = error; }
        @Override public void send(MimeMessage m) { if (++calls <= failures) throw error.get(); }
    }

    private MailService serviceFor(Flaky f) {
        @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(f);
        return new MailService(provider, TestSupport.props(), "no-reply@speak.example");
    }

    private static MailDeliveryException failureOf(Runnable send) {
        return (MailDeliveryException) catchThrowable(send::run);
    }

    @Test
    void aTemporaryNetworkFailureIsRetriedOnceWhileThePersonWaitsAndThenSucceeds() {
        Flaky f = new Flaky(1, () -> new org.springframework.mail.MailSendException("down", new java.net.ConnectException("refused")));
        serviceFor(f).sendVerificationEmail("ana@example.com", "t", "123456");
        assertThat(f.calls).isEqualTo(2);
    }

    @Test
    void aTemporaryFailureThatDoesNotEndIsReportedAsATimeoutAfterTheRetry() {
        Flaky f = new Flaky(99, () -> new org.springframework.mail.MailSendException("down", new java.net.SocketTimeoutException("timed out")));
        MailDeliveryException e = failureOf(() -> serviceFor(f).sendVerificationEmail("ana@example.com", "t", "123456"));
        assertThat(e).isNotNull();
        assertThat(e.kind()).isEqualTo(MailDeliveryException.Kind.TIMEOUT);
        assertThat(f.calls).isEqualTo(2);
    }

    @Test
    void wrongCredentialsAreReportedAndNotRetriedBecauseRetryingCannotFixThem() {
        Flaky f = new Flaky(99, () -> new org.springframework.mail.MailAuthenticationException("535 authentication failed"));
        MailDeliveryException e = failureOf(() -> serviceFor(f).sendVerificationEmail("ana@example.com", "t", "123456"));
        assertThat(e).isNotNull();
        assertThat(e.kind()).isEqualTo(MailDeliveryException.Kind.LOGIN_REFUSED);
        assertThat(f.calls).isEqualTo(1);
    }

    @Test
    void aPermanentRefusalOfTheRecipientIsReportedAndNotRetried() {
        Flaky f = new Flaky(99, () -> new org.springframework.mail.MailSendException("rejected",
                new org.eclipse.angus.mail.smtp.SMTPSendFailedException("RCPT", 550, "mailbox unavailable", null, null, null, null)));
        MailDeliveryException e = failureOf(() -> serviceFor(f).sendPasswordResetEmail("ana@example.com", "t", "123456"));
        assertThat(e).isNotNull();
        assertThat(e.kind()).isEqualTo(MailDeliveryException.Kind.RECIPIENT_REFUSED);
        assertThat(f.calls).isEqualTo(1);
    }

    @Test
    void failuresAreSortedIntoKindsThePersonCanBeToldAbout() {
        assertThat(MailService.classify(new org.springframework.mail.MailAuthenticationException("535"))).isEqualTo(MailDeliveryException.Kind.LOGIN_REFUSED);
        assertThat(MailService.classify(new org.springframework.mail.MailSendException("x", new java.net.SocketTimeoutException("t")))).isEqualTo(MailDeliveryException.Kind.TIMEOUT);
        assertThat(MailService.classify(new org.springframework.mail.MailSendException("x", new java.net.ConnectException("c")))).isEqualTo(MailDeliveryException.Kind.CONNECTION);
        assertThat(MailService.classify(new org.springframework.mail.MailSendException("x", new java.net.UnknownHostException("h")))).isEqualTo(MailDeliveryException.Kind.CONNECTION);
        assertThat(MailService.classify(new org.springframework.mail.MailSendException("x", new org.eclipse.angus.mail.smtp.SMTPSendFailedException("MAIL", 550, "5.7.1 sender not allowed", null, null, null, null))))
                .isEqualTo(MailDeliveryException.Kind.SENDER_REFUSED);
        assertThat(MailService.classify(new IllegalStateException("something else"))).isEqualTo(MailDeliveryException.Kind.OTHER);
    }

    @Test
    void aFailedPracticeReminderIsStillNeverThrownBecauseNobodyIsWaitingForIt() {
        Flaky f = new Flaky(99, () -> new org.springframework.mail.MailAuthenticationException("535 authentication failed"));
        serviceFor(f).sendReminderEmail("ana@example.com", "Ana"); // must not throw
        assertThat(f.calls).isEqualTo(1);
    }

    @Test
    void aTryAgainLaterAnswerFromTheMailServerIsRetried() {
        Flaky f = new Flaky(1, () -> new org.springframework.mail.MailSendException("greylisted",
                new org.eclipse.angus.mail.smtp.SMTPSendFailedException("RCPT", 451, "try again later", null, null, null, null)));
        serviceFor(f).sendVerificationEmail("ana@example.com", "t", "123456");
        assertThat(f.calls).isEqualTo(2);
    }

    @Test
    void failureLogsNeverContainTheCode() {
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(MailService.class);
        var appender = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        try {
            assertThat(failureOf(() -> serviceFor(new Flaky(99, () -> new org.springframework.mail.MailAuthenticationException("535 authentication failed")))
                    .sendVerificationEmail("ana@example.com", "secrettoken", "918273"))).isNotNull();
            assertThat(appender.list).isNotEmpty();
            assertThat(appender.list.toString()).doesNotContain("918273").doesNotContain("secrettoken");
        } finally {
            logger.detachAppender(appender);
        }
    }

    @Test
    void inDevelopmentASuccessfulSendIsLoggedWithTheFullRecipientAndNeverTheCode() {
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(MailService.class);
        var appender = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        try {
            serviceFor(plainSender()).sendVerificationEmail("ana.smith@example.com", "secrettoken", "918273");
            String logged = appender.list.stream().map(e -> e.getFormattedMessage()).reduce("", (a, b) -> a + "\n" + b);
            assertThat(logged).contains("accepted by the mail server for ana.smith@example.com").doesNotContain("918273").doesNotContain("secrettoken");
        } finally {
            logger.detachAppender(appender);
        }
    }

    @Test
    void aDeployedServerLogsOnlyAMaskedRecipient() {
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(MailService.class);
        var appender = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        try {
            var props = new com.englishspeaking.platform.security.AppProperties("n", "https://speak.example.com", "https://speak.example.com", new com.englishspeaking.platform.security.AppProperties.Jwt("x".repeat(32), 15), 30, true,
                    new com.englishspeaking.platform.security.AppProperties.Turn(), "", new com.englishspeaking.platform.security.AppProperties.Coach("", "m", "u", 20));
            @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> provider = mock(ObjectProvider.class);
            when(provider.getIfAvailable()).thenReturn(plainSender());
            new MailService(provider, props, "no-reply@speak.example").sendVerificationEmail("ana.smith@example.com", "secrettoken", "918273");
            String logged = appender.list.stream().map(e -> e.getFormattedMessage()).reduce("", (a, b) -> a + "\n" + b);
            assertThat(logged).contains("accepted by the mail server for ana***@example.com").doesNotContain("ana.smith").doesNotContain("918273");
        } finally {
            logger.detachAppender(appender);
        }
    }

    @Test
    void addressesAreMaskedForLogs() {
        assertThat(MailService.maskAddress("ana.smith@example.com")).isEqualTo("ana***@example.com");
        assertThat(MailService.maskAddress("jo@example.com")).isEqualTo("jo***@example.com");
        assertThat(MailService.maskAddress("not-an-address")).isEqualTo("***");
        assertThat(MailService.maskAddress(null)).isEqualTo("?");
    }

    @Test
    void theMessageIdIsBuiltFromTheSendingAddressDomainNotTheComputersOwnName() throws Exception {
        @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(MailConfig.build("127.0.0.1", smtp.getSmtp().getPort(), "", "", false, MailConfig.domainOf("Speakora <no-reply@example.com>")));
        new MailService(provider, TestSupport.props(), "no-reply@example.com").sendVerificationEmail("ana@example.com", "t", "123456");
        String id = only().getHeader("Message-ID")[0];
        assertThat(id).matches("<[0-9a-f-]{36}@example\\.com>");
        assertThat(id.toLowerCase()).doesNotContain(java.net.InetAddress.getLocalHost().getHostName().toLowerCase());
    }

    @Test
    void theSendingDomainIsTakenFromTheConfiguredAddress() {
        assertThat(MailConfig.domainOf("no-reply@example.com")).isEqualTo("example.com");
        assertThat(MailConfig.domainOf("Speakora <No-Reply@Mail.Speak.Example>")).isEqualTo("mail.speak.example");
        assertThat(MailConfig.domainOf("")).isNull();
        assertThat(MailConfig.domainOf("not-an-address")).isNull();
        assertThat(MailConfig.domainOf("x@localhost")).isNull();
    }

    @Test
    void anEmptyOrExampleSenderIsRecognisedAsAPlaceholder() {
        assertThat(MailService.isPlaceholderSender("")).isTrue();
        assertThat(MailService.isPlaceholderSender("no-reply@example.com")).isTrue();
        assertThat(MailService.isPlaceholderSender("Speak <hello@example.org>")).isTrue();
        assertThat(MailService.isPlaceholderSender("no-reply@speak.example")).isFalse();
        assertThat(MailService.isPlaceholderSender("no-reply@provider.invalid")).isFalse();
    }

    @Test
    void checkedSendAndCodeEmailsBothReportAFailureToConnect() {
        MailService ok = serviceFor(plainSender());
        ok.sendChecked("admin@example.com", "Test", "body");
        assertThat(smtp.getReceivedMessages()).hasSize(1);

        MailService down = serviceFor(MailConfig.build("127.0.0.1", 1, "", "", false)); // nothing listens on port 1
        assertThatThrownBy(() -> down.sendChecked("admin@example.com", "Test", "body")).isInstanceOf(MailException.class);
        MailDeliveryException e = failureOf(() -> down.sendVerificationEmail("ana@example.com", "t", "000000")); // a code the person waits for is never swallowed
        assertThat(e).isNotNull();
        assertThat(e.kind()).isEqualTo(MailDeliveryException.Kind.CONNECTION);
    }

    @Test
    void starttlsIsRequiredWhenEnabledSoMailIsNeverSentInClearTextByAccident() {
        // GreenMail's plain SMTP does not offer STARTTLS, so a sender that requires it must refuse to deliver.
        MailService strict = serviceFor(MailConfig.build("127.0.0.1", smtp.getSmtp().getPort(), "", "", true));
        assertThatThrownBy(() -> strict.sendChecked("admin@example.com", "Test", "body")).isInstanceOf(MailException.class);
        assertThat(smtp.getReceivedMessages()).isEmpty();
    }

    @Test
    void authenticationIsUsedWhenCredentialsAreGiven() {
        smtp.setUser("mailer@example.com", "mailer", "s3cret");
        MailService svc = serviceFor(MailConfig.build("127.0.0.1", smtp.getSmtp().getPort(), "mailer", "s3cret", false));
        svc.sendChecked("admin@example.com", "Test", "body");
        assertThat(smtp.getReceivedMessages()).hasSize(1);
        MailService wrong = serviceFor(MailConfig.build("127.0.0.1", smtp.getSmtp().getPort(), "mailer", "wrong", false));
        assertThatThrownBy(() -> wrong.sendChecked("admin@example.com", "Test", "body")).isInstanceOf(MailException.class);
    }

    @Test
    void withoutSmtpTheServiceSaysSoInsteadOfPretendingToSend() {
        @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> none = mock(ObjectProvider.class);
        MailService svc = new MailService(none, TestSupport.props(), "no-reply@x");
        assertThat(svc.isSmtpConfigured()).isFalse();
        assertThatThrownBy(() -> svc.sendChecked("a@b.com", "s", "b")).isInstanceOf(IllegalStateException.class).hasMessageContaining("SMTP is not configured");
    }

    @Test
    void withoutSmtpOnALocalAddressTheEmailIsShownInTheLogForDevelopment() {
        var appender = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        appender.start();
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(MailService.class);
        logger.addAppender(appender);
        try {
            @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> none = mock(ObjectProvider.class);
            new MailService(none, TestSupport.props(), "no-reply@x").sendVerificationEmail("ana@example.com", "tok123", "482913");
            assertThat(appender.list).anyMatch(e -> e.getFormattedMessage().contains("482913") && e.getFormattedMessage().contains("ana@example.com"));
        } finally {
            logger.detachAppender(appender);
        }
    }

    @Test
    void aDeployedServerWithoutSmtpNeverWritesCodesOrLinksIntoItsLogs() {
        var appender = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        appender.start();
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(MailService.class);
        logger.addAppender(appender);
        try {
            @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> none = mock(ObjectProvider.class);
            var props = new com.englishspeaking.platform.security.AppProperties("n", "https://speak.example.com", "https://speak.example.com", new com.englishspeaking.platform.security.AppProperties.Jwt("x".repeat(32), 15), 30, true,
                    new com.englishspeaking.platform.security.AppProperties.Turn(), "", new com.englishspeaking.platform.security.AppProperties.Coach("", "m", "u", 20));
            var svc = new MailService(none, props, "no-reply@x");
            // nothing can be sent, and the person is told so (not left waiting for an email that will never come)
            assertThat(failureOf(() -> svc.sendVerificationEmail("ana@example.com", "secret-link-token", "482913")).kind()).isEqualTo(MailDeliveryException.Kind.NOT_CONFIGURED);
            assertThat(failureOf(() -> svc.sendPasswordResetEmail("ana@example.com", "secret-reset-token", "190377")).kind()).isEqualTo(MailDeliveryException.Kind.NOT_CONFIGURED);
            String all = String.join("\n", appender.list.stream().map(ch.qos.logback.classic.spi.ILoggingEvent::getFormattedMessage).toList());
            assertThat(all).doesNotContain("482913").doesNotContain("190377").doesNotContain("secret-link-token").doesNotContain("secret-reset-token");
            assertThat(all).contains("NOT sent").contains("SMTP_HOST");
        } finally {
            logger.detachAppender(appender);
        }
    }

    @Test
    void localAddressesAreRecognisedAndPublicOnesAreNot() {
        for (String local : new String[] {"http://localhost:5173", "http://127.0.0.1:8080", "http://192.168.1.20:5173", "http://10.0.0.5"}) assertThat(MailService.isLocal(local)).as(local).isTrue();
        for (String remote : new String[] {"https://speak.example.com", "http://speak.example.com", "https://localhost.evil.example.com", null}) assertThat(MailService.isLocal(remote)).as(String.valueOf(remote)).isFalse();
    }
}
