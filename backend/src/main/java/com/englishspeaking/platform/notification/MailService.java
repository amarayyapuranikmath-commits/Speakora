package com.englishspeaking.platform.notification;

import com.englishspeaking.platform.security.AppProperties;
import jakarta.annotation.PreDestroy;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Sends transactional email over SMTP when configured (SMTP_HOST). Without SMTP the message is written to the log, but only when the
 * app runs on a local address, so a developer can read the code; a deployed server never logs codes or links.
 *
 * <p>Every message is multipart (HTML and plain text) and carries the application's name as the sender's display name, with the
 * address from MAIL_FROM. The sign-up and reset codes are sent while the person waits, so a failure is reported to them (MailDeliveryException)
 * instead of being hidden; practice reminders are sent in the background. Transient failures (network, timeouts, a 4xx answer) are retried,
 * permanent ones (wrong credentials, a 5xx refusal) are not, and every failure is logged without the message content.
 */
@Service
public class MailService {
    private static final Logger log = LoggerFactory.getLogger(MailService.class);
    private static final int ATTEMPTS = 3;
    /** A person is waiting for a code: one retry for a transient failure, then tell them. */
    private static final int USER_FACING_ATTEMPTS = 2;

    private final ObjectProvider<JavaMailSender> sender;
    private final AppProperties props;
    private final String from;
    private final ExecutorService background; // null = send on the calling thread (tests)
    /** Waits before the 2nd and 3rd attempt; a test sets these to zero. */
    long[] retryDelaysMillis = {1_000, 4_000};
    /**
     * Plain text by default: a simple, single-part message is what a new sending account gets delivered reliably (the project's other Gmail-sending
     * service, Nexora, sends plain text). MAIL_HTML=true adds the HTML version as a second part of a plain multipart/alternative message.
     */
    boolean html;

    /** The server: sends in the background. */
    @Autowired
    public MailService(ObjectProvider<JavaMailSender> sender, AppProperties props,
                       @Value("${app.mail-from:no-reply@example.com}") String from,
                       @Value("${app.mail-async:true}") boolean async,
                       @Value("${app.mail-html:false}") boolean html) {
        this.html = html;
        this.sender = sender;
        this.props = props;
        this.from = from;
        this.background = async ? Executors.newVirtualThreadPerTaskExecutor() : null;
        warnAboutPlaceholderSender();
    }

    /** Sends on the calling thread, so a test can read the result straight away. */
    public MailService(ObjectProvider<JavaMailSender> sender, AppProperties props, String from) {
        this(sender, props, from, false, false);
        this.retryDelaysMillis = new long[] {0, 0};
    }

    @PreDestroy
    void stop() { if (background != null) background.shutdown(); }

    // --- messages ---------------------------------------------------------------------------------------------------------------

    /** Sends the sign-up code now. @throws MailDeliveryException when the mail server does not take the message. */
    public void sendVerificationEmail(String to, String token, String code) {
        sendNow(to, EmailTemplates.verification(props.name(), code, linkTo("/verify-email?token=" + token), 30, 24));
    }

    /** Sends the password-reset code now. @throws MailDeliveryException when the mail server does not take the message. */
    public void sendPasswordResetEmail(String to, String token, String code) {
        sendNow(to, EmailTemplates.passwordReset(props.name(), code, linkTo("/reset-password?token=" + token), 30, 60));
    }

    /**
     * The link in a code email, or null when it would be useless: a real email sent while the app runs on a local address would point at localhost, which
     * nobody reading it on another device can open (and which spam filters dislike). Without SMTP the email is only logged, and the link is kept there
     * so a developer can follow it.
     */
    private String linkTo(String path) {
        boolean realEmailToALocalAddress = sender.getIfAvailable() != null && isLocal(props.baseUrl());
        return realEmailToALocalAddress ? null : props.baseUrl() + path;
    }

    public void sendReminderEmail(String to, String displayName) {
        send(to, EmailTemplates.reminder(props.name(), displayName, props.baseUrl() + "/app/talk", props.baseUrl() + "/app/settings"), true);
    }

    // --- state and diagnostics --------------------------------------------------------------------------------------------------

    /** True when an SMTP host is configured; otherwise emails are only written to the log. */
    public boolean isSmtpConfigured() { return sender.getIfAvailable() != null; }

    /** The sender as recipients see it: the application's name and the configured address. */
    public String fromAddress() { return fromHeader().toString(); }

    /** Sends a diagnostic email and REPORTS failure (unlike normal mail, which must never break a user flow). */
    public void sendChecked(String to, String subject, String body) {
        JavaMailSender mailSender = sender.getIfAvailable();
        if (mailSender == null) throw new IllegalStateException("SMTP is not configured (set SMTP_HOST and credentials). Emails are currently only written to the server log.");
        try {
            mailSender.send(build(mailSender, to, new EmailTemplates.Email(subject, null, body), false));
        } catch (jakarta.mail.MessagingException e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    static boolean isLocal(String baseUrl) {
        if (baseUrl == null) return false;
        String u = baseUrl.toLowerCase(java.util.Locale.ROOT);
        return u.startsWith("http://localhost") || u.startsWith("http://127.") || u.startsWith("http://[::1]") || u.startsWith("http://10.") || u.startsWith("http://192.168.");
    }

    /** True when the configured sender is empty or still the placeholder from the example settings, which no mail provider will accept. */
    public static boolean isPlaceholderSender(String from) {
        if (from == null || from.isBlank()) return true;
        String f = from.toLowerCase(java.util.Locale.ROOT);
        return f.matches(".*@(example\\.(com|org|net)|localhost)[>\\s]*$");
    }

    // --- sending ----------------------------------------------------------------------------------------------------------------

    private void warnAboutPlaceholderSender() {
        if (sender.getIfAvailable() != null && isPlaceholderSender(from)) {
            log.warn("SMTP is configured but MAIL_FROM is empty or an example address. Mail providers refuse or spam-folder mail from an address on a domain "
                    + "that is not verified with them; set MAIL_FROM to a verified sender (see docs/EMAIL.md).");
        }
    }

    private InternetAddress fromHeader() {
        String address = from == null ? "" : from.trim();
        try {
            InternetAddress[] parsed = InternetAddress.parse(address, false);
            String bare = parsed.length > 0 ? parsed[0].getAddress() : address;
            // Always the application's name, never a person's name or a server name.
            return new InternetAddress(bare, props.name(), "UTF-8");
        } catch (jakarta.mail.internet.AddressException | UnsupportedEncodingException e) {
            throw new IllegalStateException("MAIL_FROM is not a valid email address", e);
        }
    }

    private MimeMessage build(JavaMailSender mailSender, String to, EmailTemplates.Email email, boolean reminder) throws jakarta.mail.MessagingException {
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, "UTF-8"); // no multipart wrapper unless the HTML version is sent
        helper.setFrom(fromHeader());
        helper.setTo(to);
        helper.setSubject(email.subject());
        if (email.html() == null || !html) {
            helper.setText(email.text(), false);
        } else {
            // One flat multipart/alternative: plain text first, HTML second, so the client shows the best it can.
            jakarta.mail.internet.MimeMultipart alternative = new jakarta.mail.internet.MimeMultipart("alternative");
            jakarta.mail.internet.MimeBodyPart text = new jakarta.mail.internet.MimeBodyPart();
            text.setText(email.text(), "UTF-8");
            jakarta.mail.internet.MimeBodyPart page = new jakarta.mail.internet.MimeBodyPart();
            page.setContent(email.html(), "text/html; charset=UTF-8");
            alternative.addBodyPart(text);
            alternative.addBodyPart(page);
            message.setContent(alternative);
        }
        message.setHeader("Auto-Submitted", "auto-generated"); // an automatic message: no auto-replies, no vacation responders
        if (reminder) { // lets mail clients offer one-click unsubscribe
            message.setHeader("List-Unsubscribe", "<" + props.baseUrl() + "/app/settings>");
        }
        return message;
    }

    private void send(String to, EmailTemplates.Email email, boolean reminder) {
        JavaMailSender mailSender = sender.getIfAvailable();
        if (mailSender == null) {
            // Development convenience: show the email (it holds a sign-in code and link) only when the app runs on a local address. A deployed
            // server without SMTP must never write codes or links into its logs; it says that the email was not sent and why.
            if (isLocal(props.baseUrl())) log.info("SMTP not configured. Email to {} | {}\n{}", to, email.subject(), email.text());
            else log.warn("SMTP is not configured (set SMTP_HOST): the email '{}' to {} was NOT sent.", email.subject(), to);
            return;
        }
        if (background == null) deliver(mailSender, to, email, reminder);
        else background.execute(() -> deliver(mailSender, to, email, reminder));
    }

    /** A message a person is waiting for: sent on the calling thread, and a failure is reported, not hidden. */
    private void sendNow(String to, EmailTemplates.Email email) {
        JavaMailSender mailSender = sender.getIfAvailable();
        if (mailSender == null) {
            // Development convenience: show the email (it holds a sign-in code and link) only when the app runs on a local address. A deployed
            // server without SMTP never writes codes or links into its logs, and the person is told that no email can be sent.
            if (isLocal(props.baseUrl())) {
                log.info("SMTP not configured. Email to {} | {}\n{}", to, email.subject(), email.text());
                return;
            }
            log.warn("SMTP is not configured (set SMTP_HOST): the email '{}' to {} was NOT sent.", email.subject(), recipientForLog(to));
            throw new MailDeliveryException(MailDeliveryException.Kind.NOT_CONFIGURED, "Email sending is not configured", null);
        }
        deliverOrThrow(mailSender, to, email, false, USER_FACING_ATTEMPTS);
    }

    /** Background mail (reminders): never throws, so a delivery failure cannot break anything. */
    private void deliver(JavaMailSender mailSender, String to, EmailTemplates.Email email, boolean reminder) {
        try {
            deliverOrThrow(mailSender, to, email, reminder, ATTEMPTS);
        } catch (MailDeliveryException e) {
            // already logged, with the reason, by deliverOrThrow
        }
    }

    private void deliverOrThrow(JavaMailSender mailSender, String to, EmailTemplates.Email email, boolean reminder, int attempts) {
        MailDeliveryException last = null;
        for (int attempt = 1; attempt <= attempts; attempt++) {
            try {
                mailSender.send(build(mailSender, to, email, reminder));
                // Every successful hand-over is logged (recipient shown in development and masked on a server, never the code or the link),
                // so "sent" and "not sent" can be told apart.
                log.info("Email '{}' accepted by the mail server for {} (attempt {})", email.subject(), recipientForLog(to), attempt);
                return;
            } catch (jakarta.mail.MessagingException | RuntimeException e) {
                boolean retry = attempt < attempts && isTransient(e);
                // The message content (a code or a link) is never logged.
                log.error("Sending email '{}' to {} failed ({}, attempt {} of {}): {}{}", email.subject(), recipientForLog(to), e.getClass().getSimpleName(), attempt, attempts,
                        describe(e), retry ? "; will retry" : (isTransient(e) ? "; giving up" : "; not retrying: this will not fix itself"));
                last = new MailDeliveryException(classify(e), describe(e), e);
                if (!retry) throw last;
                try {
                    Thread.sleep(retryDelaysMillis[Math.min(attempt - 1, retryDelaysMillis.length - 1)]);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw last;
                }
            }
        }
        if (last != null) throw last;
    }

    /** Which kind of failure this is, for the message the person sees. */
    static MailDeliveryException.Kind classify(Throwable e) {
        if (e instanceof MailAuthenticationException) return MailDeliveryException.Kind.LOGIN_REFUSED;
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof jakarta.mail.AuthenticationFailedException) return MailDeliveryException.Kind.LOGIN_REFUSED;
            if (t instanceof org.eclipse.angus.mail.smtp.SMTPAddressFailedException a) {
                return a.getReturnCode() >= 500 ? MailDeliveryException.Kind.RECIPIENT_REFUSED : MailDeliveryException.Kind.OTHER;
            }
            if (t instanceof org.eclipse.angus.mail.smtp.SMTPSenderFailedException) return MailDeliveryException.Kind.SENDER_REFUSED;
            if (t instanceof org.eclipse.angus.mail.smtp.SMTPSendFailedException s && s.getReturnCode() >= 500) {
                String m = String.valueOf(s.getMessage()).toLowerCase(java.util.Locale.ROOT);
                return m.contains("sender") || m.contains("from") || m.contains("5.7.1") ? MailDeliveryException.Kind.SENDER_REFUSED : MailDeliveryException.Kind.RECIPIENT_REFUSED;
            }
            if (t instanceof java.net.SocketTimeoutException) return MailDeliveryException.Kind.TIMEOUT;
            if (t instanceof java.net.ConnectException || t instanceof java.net.UnknownHostException || t instanceof java.net.NoRouteToHostException) return MailDeliveryException.Kind.CONNECTION;
        }
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof IOException) return MailDeliveryException.Kind.CONNECTION;
        }
        return MailDeliveryException.Kind.OTHER;
    }

    /**
     * Who the message was addressed to, for the log. On a local address (development) the full recipient is shown, so it is easy to see exactly
     * where each email was sent; on a deployed server it is masked. Never the code or the link.
     */
    private String recipientForLog(String to) {
        return isLocal(props.baseUrl()) ? to : maskAddress(to);
    }

    /** "ana.smith@example.com" becomes "ana***@example.com": enough to recognise the address in a log, not enough to read it. */
    static String maskAddress(String address) {
        if (address == null) return "?";
        int at = address.lastIndexOf('@');
        if (at <= 0) return "***";
        return address.substring(0, Math.min(3, at)) + "***" + address.substring(at);
    }

    /** Network trouble, timeouts and a 4xx "try again later" are worth another attempt; bad credentials and 5xx refusals are not. */
    static boolean isTransient(Throwable e) {
        if (e instanceof MailAuthenticationException) return false;
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof jakarta.mail.AuthenticationFailedException) return false;
            if (t instanceof org.eclipse.angus.mail.smtp.SMTPAddressFailedException a) return a.getReturnCode() >= 400 && a.getReturnCode() < 500;
            if (t instanceof org.eclipse.angus.mail.smtp.SMTPSendFailedException s) return s.getReturnCode() >= 400 && s.getReturnCode() < 500;
            if (t instanceof IOException) return true; // connection refused / reset / timed out
        }
        return e instanceof MailSendException; // anything else the mail layer could not send: try again
    }

    private static String describe(Throwable e) {
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        String m = root.getMessage();
        return m == null ? root.getClass().getSimpleName() : (m.length() > 200 ? m.substring(0, 200) : m);
    }
}
