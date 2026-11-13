package com.englishspeaking.platform.notification;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.util.Properties;

/**
 * SMTP is enabled by SMTP_HOST (see env.example). With no host the app logs emails instead of sending them.
 * Port 465 uses implicit TLS; any other port uses STARTTLS unless SMTP_STARTTLS=false (only for a local test server).
 */
@Configuration
public class MailConfig {
    @Bean
    @ConditionalOnExpression("'${SMTP_HOST:}'.length() > 0")
    JavaMailSender javaMailSender(@Value("${SMTP_HOST:}") String host, @Value("${SMTP_PORT:587}") int port,
                                  @Value("${SMTP_USER:}") String user, @Value("${SMTP_PASSWORD:}") String password,
                                  @Value("${SMTP_STARTTLS:true}") boolean startTls,
                                  @Value("${app.mail-from:}") String from) {
        return build(host, port, user, password, startTls, domainOf(from));
    }

    static JavaMailSenderImpl build(String host, int port, String user, String password, boolean startTls) {
        return build(host, port, user, password, startTls, null);
    }

    /** The domain of the sending address ("gmail.com" for "Name <sender@example.com>"), or null when there is none. */
    static String domainOf(String from) {
        if (from == null) return null;
        int at = from.lastIndexOf('@');
        if (at < 0) return null;
        String d = from.substring(at + 1).replaceAll("[>\\s].*$", "").toLowerCase(java.util.Locale.ROOT);
        return d.contains(".") ? d : null;
    }

    /**
     * Gives every message a Message-ID built from the sending address's own domain. By default JavaMail uses the sending computer's own name (for
     * example "LAPTOP-EXAMPLE"), which is not a qualified domain name and is a common reason for spam filters to distrust a message.
     */
    static final class QualifiedMessageIdSender extends JavaMailSenderImpl {
        private final String domain;

        QualifiedMessageIdSender(String domain) { this.domain = domain; }

        @Override
        public jakarta.mail.internet.MimeMessage createMimeMessage() {
            return new jakarta.mail.internet.MimeMessage(getSession()) {
                @Override
                protected void updateMessageID() throws jakarta.mail.MessagingException {
                    setHeader("Message-ID", "<" + java.util.UUID.randomUUID() + "@" + domain + ">");
                }
            };
        }
    }

    static JavaMailSenderImpl build(String host, int port, String user, String password, boolean startTls, String messageIdDomain) {
        JavaMailSenderImpl sender = messageIdDomain == null ? new JavaMailSenderImpl() : new QualifiedMessageIdSender(messageIdDomain);
        sender.setHost(host);
        sender.setPort(port);
        sender.setDefaultEncoding("UTF-8");
        Properties p = sender.getJavaMailProperties();
        p.put("mail.transport.protocol", "smtp");
        p.put("mail.smtp.connectiontimeout", "10000");
        p.put("mail.smtp.timeout", "15000");
        p.put("mail.smtp.writetimeout", "15000");
        if (user != null && !user.isBlank()) {
            sender.setUsername(user);
            sender.setPassword(password);
            p.put("mail.smtp.auth", "true");
        }
        if (port == 465) {
            p.put("mail.smtp.ssl.enable", "true");
        } else if (startTls) {
            p.put("mail.smtp.starttls.enable", "true");
            p.put("mail.smtp.starttls.required", "true"); // never silently fall back to sending in clear text
        }
        return sender;
    }
}
