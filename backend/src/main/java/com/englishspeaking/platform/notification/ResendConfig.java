package com.englishspeaking.platform.notification;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Resend is enabled by RESEND_API_KEY and takes precedence over SMTP. With no key the app uses SMTP (SMTP_HOST) or, on a local address, logs emails.
 * A key that cannot be right (spaces, quotes, line breaks from a bad copy and paste) stops the start with a message that names the setting and
 * never prints the key.
 */
@Configuration
public class ResendConfig {
    private static final Logger log = LoggerFactory.getLogger(ResendConfig.class);

    @Bean
    @ConditionalOnExpression("'${RESEND_API_KEY:}'.trim().length() > 0")
    ResendClient resendClient(@Value("${RESEND_API_KEY:}") String apiKey, @Value("${RESEND_API_URL:https://api.resend.com}") String apiUrl,
                              @Value("${app.mail-from:}") String from) {
        String key = validatedKey(apiKey);
        if (MailService.isPlaceholderSender(from)) {
            log.warn("RESEND_API_KEY is set but MAIL_FROM is empty or an example address. Resend refuses a sender on a domain you have not verified; "
                    + "use a verified-domain address, or onboarding@resend.dev while testing (docs/EMAIL.md).");
        } else if (usesResendTestSender(from)) {
            log.warn("MAIL_FROM is a resend.dev address: Resend only delivers such mail to the email address of your own Resend account. "
                    + "Verify a domain at resend.com/domains to email other people (docs/EMAIL.md).");
        }
        if (!key.startsWith("re_")) log.warn("RESEND_API_KEY does not start with \"re_\" as Resend API keys do; check that the right value was copied.");
        log.info("Email provider: Resend HTTP API (SMTP is not used while RESEND_API_KEY is set).");
        return new ResendClient(key, apiUrl);
    }

    /** The trimmed key, or an IllegalStateException that says what is wrong without including the key. */
    static String validatedKey(String apiKey) {
        String key = apiKey == null ? "" : apiKey.trim();
        if (key.isEmpty()) throw new IllegalStateException("RESEND_API_KEY is empty");
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            if (Character.isWhitespace(c) || c == '"' || c == '\'' || Character.isISOControl(c)) {
                throw new IllegalStateException("RESEND_API_KEY contains a space, quote or line break (value not shown). Paste only the key itself, without quotes.");
            }
        }
        return key;
    }

    static boolean usesResendTestSender(String from) {
        return from != null && from.toLowerCase(java.util.Locale.ROOT).replaceAll("[>\\s]+$", "").endsWith("@resend.dev");
    }
}
