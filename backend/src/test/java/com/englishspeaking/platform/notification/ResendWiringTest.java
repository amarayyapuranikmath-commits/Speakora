package com.englishspeaking.platform.notification;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/** The Spring wiring of the providers, driven by the same property names Render sets (RESEND_API_KEY, SMTP_HOST, MAIL_FROM). */
class ResendWiringTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner().withUserConfiguration(ResendConfig.class, MailConfig.class);

    @Test
    void noKeyMeansNoResendClient() {
        runner.withPropertyValues("RESEND_API_KEY=", "app.mail-from=no-reply@speak.example")
                .run(c -> assertThat(c).doesNotHaveBean(ResendClient.class));
    }

    @Test
    void aWhitespaceOnlyKeyCountsAsNotSet() {
        runner.withPropertyValues("RESEND_API_KEY=   ").run(c -> assertThat(c).doesNotHaveBean(ResendClient.class));
    }

    @Test
    void aKeyCreatesTheClientAndItsToStringHidesTheKey() {
        runner.withPropertyValues("RESEND_API_KEY=re_abc123SECRET", "app.mail-from=onboarding@resend.dev").run(c -> {
            assertThat(c).hasSingleBean(ResendClient.class);
            assertThat(c.getBean(ResendClient.class).toString()).doesNotContain("abc123SECRET");
        });
    }

    @Test
    void aMalformedKeyStopsTheStartAndTheErrorNeverContainsTheKey() {
        runner.withPropertyValues("RESEND_API_KEY=\"re_quoted SECRET\"").run(c -> {
            assertThat(c).hasFailed();
            assertThat(c.getStartupFailure().toString() + rootMessages(c.getStartupFailure())).contains("RESEND_API_KEY").doesNotContain("quoted SECRET");
        });
    }

    @Test
    void resendAndSmtpCanBothBeConfiguredAndResendIsSimplyAdditional() {
        runner.withPropertyValues("RESEND_API_KEY=re_x1", "SMTP_HOST=smtp.example.net", "app.mail-from=a@speak.example").run(c -> {
            assertThat(c).hasSingleBean(ResendClient.class);
            assertThat(c).hasSingleBean(org.springframework.mail.javamail.JavaMailSender.class);
        });
    }

    private static String rootMessages(Throwable t) {
        StringBuilder b = new StringBuilder();
        for (; t != null; t = t.getCause()) b.append(t.getMessage()).append('\n');
        return b.toString();
    }
}
