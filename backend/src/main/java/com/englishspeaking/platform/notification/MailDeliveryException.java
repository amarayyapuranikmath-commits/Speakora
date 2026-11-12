package com.englishspeaking.platform.notification;

/**
 * An email that a person is waiting for (a sign-up or reset code) could not be handed to the mail server. The category says why, so the app can tell the
 * person something useful instead of pretending the email went out. It never carries the message, a code or a credential.
 */
public class MailDeliveryException extends RuntimeException {
    public enum Kind {
        /** No SMTP server is set up on a deployed server. */
        NOT_CONFIGURED,
        /** The mail server refused our login (wrong or revoked username / app password). */
        LOGIN_REFUSED,
        /** The mail server refused the sender address. */
        SENDER_REFUSED,
        /** The mail server refused the recipient address. */
        RECIPIENT_REFUSED,
        /** The mail server did not answer in time. */
        TIMEOUT,
        /** The mail server could not be reached. */
        CONNECTION,
        OTHER
    }

    private final Kind kind;

    public MailDeliveryException(Kind kind, String message, Throwable cause) {
        super(message, cause);
        this.kind = kind;
    }

    public Kind kind() { return kind; }
}
