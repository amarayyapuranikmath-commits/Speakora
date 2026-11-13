package com.englishspeaking.platform.notification;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.Locale;

/**
 * Sends email through the Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email) over HTTPS port 443, so it works on hosts
 * that block outbound SMTP (Render's free plan blocks ports 25, 465 and 587).
 *
 * <p>The API key lives only in this object (never in {@code toString}, a log line, an exception message or any response to a browser or phone).
 * A failure is reported as a {@link ResendException} that carries the category, the HTTP status and Resend's short error name, and never the
 * message, a code, a link or the key.
 */
public class ResendClient {
    public static final String DEFAULT_API_URL = "https://api.resend.com";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final String apiKey;
    private final URI endpoint;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public ResendClient(String apiKey, String apiUrl) {
        this.apiKey = apiKey;
        String base = apiUrl == null || apiUrl.isBlank() ? DEFAULT_API_URL : apiUrl.trim();
        this.endpoint = URI.create((base.endsWith("/") ? base.substring(0, base.length() - 1) : base) + "/emails");
    }

    /** Never prints the key. */
    @Override
    public String toString() { return "ResendClient[" + endpoint + ", apiKey=***]"; }

    /**
     * Hands one message to Resend.
     *
     * @param from           the full sender header, for example {@code Speakora <no-reply@speak.example>}
     * @param html           the HTML part, or null for plain text only
     * @param idempotencyKey the same value for every retry of one message, so a retry after a lost answer cannot deliver it twice
     * @throws ResendException when Resend does not accept the message
     */
    public void send(String from, String to, String subject, String text, String html, String idempotencyKey) {
        ObjectNode body = JSON.createObjectNode();
        body.put("from", from);
        body.putArray("to").add(to);
        body.put("subject", subject);
        body.put("text", text);
        if (html != null) body.put("html", html);
        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(Duration.ofSeconds(15))
                .header("Authorization", "Bearer " + apiKey)
                .header("Content-Type", "application/json")
                .header("Idempotency-Key", idempotencyKey)
                .header("User-Agent", "speakora-backend")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (HttpTimeoutException e) {
            throw new ResendException(MailDeliveryException.Kind.TIMEOUT, true, 0, "timeout", "Resend did not answer in time", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResendException(MailDeliveryException.Kind.OTHER, false, 0, "interrupted", "Interrupted while sending", e);
        } catch (IOException e) {
            throw new ResendException(MailDeliveryException.Kind.CONNECTION, true, 0, "connection", "Could not reach Resend (" + e.getClass().getSimpleName() + ")", e);
        }
        int status = response.statusCode();
        if (status >= 200 && status < 300) return;
        throw failure(status, response.body());
    }

    /** Turns an error answer into a categorised exception. The error name and message are read from Resend's JSON; neither holds our key. */
    static ResendException failure(int status, String responseBody) {
        String name = "unknown";
        String message = "";
        try {
            JsonNode json = JSON.readTree(responseBody == null ? "" : responseBody);
            if (json != null && json.hasNonNull("name")) name = clean(json.get("name").asText());
            if (json != null && json.hasNonNull("message")) message = json.get("message").asText().toLowerCase(Locale.ROOT);
        } catch (IOException | RuntimeException ignored) {
            // an answer that is not JSON still has a status
        }
        MailDeliveryException.Kind kind;
        boolean retry = false;
        if (status == 401 || name.equals("invalid_api_key") || name.equals("missing_api_key") || name.equals("restricted_api_key")) {
            kind = MailDeliveryException.Kind.LOGIN_REFUSED;
        } else if (status == 403 || status == 422) {
            // Free tier or an unverified domain: "You can only send testing emails to your own email address" / "The domain is not verified".
            if (message.contains("testing emails") || name.contains("to_address") || message.contains("recipient")) kind = MailDeliveryException.Kind.RECIPIENT_REFUSED;
            else if (message.contains("domain") || name.contains("from_address") || message.contains("from")) kind = MailDeliveryException.Kind.SENDER_REFUSED;
            else kind = status == 403 ? MailDeliveryException.Kind.SENDER_REFUSED : MailDeliveryException.Kind.RECIPIENT_REFUSED;
        } else if (status == 429 || status == 408 || status >= 500) {
            kind = MailDeliveryException.Kind.OTHER;
            retry = true; // rate limit, timeout or a Resend outage: worth another try
        } else {
            kind = MailDeliveryException.Kind.OTHER;
        }
        return new ResendException(kind, retry, status, name, "Resend answered HTTP " + status + " (" + name + ")", null);
    }

    /** Keeps only the characters of a short error name such as "validation_error", so nothing unexpected reaches a log line. */
    private static String clean(String s) {
        String t = s.replaceAll("[^A-Za-z0-9_\\-]", "");
        return t.isEmpty() ? "unknown" : (t.length() > 60 ? t.substring(0, 60) : t);
    }

    /** A message Resend did not accept. {@link #getMessage()} holds the status and Resend's error name only. */
    public static class ResendException extends RuntimeException {
        private final MailDeliveryException.Kind kind;
        private final boolean transientFailure;
        private final int status;
        private final String errorName;

        public ResendException(MailDeliveryException.Kind kind, boolean transientFailure, int status, String errorName, String message, Throwable cause) {
            super(message, cause);
            this.kind = kind;
            this.transientFailure = transientFailure;
            this.status = status;
            this.errorName = errorName;
        }

        public MailDeliveryException.Kind kind() { return kind; }
        public boolean isTransientFailure() { return transientFailure; }
        public int status() { return status; }
        public String errorName() { return errorName; }
    }
}
