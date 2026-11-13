package com.englishspeaking.platform.notification;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.englishspeaking.platform.TestSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mail.javamail.JavaMailSender;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The Resend HTTP provider against a local stand-in for api.resend.com: request shape, error mapping, retries, and that no secret is logged. */
class ResendMailTest {
    private static final String KEY = "re_SECRETKEY_1234567890";
    private static final ObjectMapper JSON = new ObjectMapper();

    private HttpServer server;
    private final Deque<int[]> statuses = new ArrayDeque<>();      // queued status codes; the last one repeats
    private final Deque<String> bodies = new ArrayDeque<>();       // queued response bodies, same order
    private final List<JsonNode> received = new CopyOnWriteArrayList<>();
    private final List<String> authHeaders = new CopyOnWriteArrayList<>();
    private final List<String> idempotencyKeys = new CopyOnWriteArrayList<>();
    private final List<String> paths = new CopyOnWriteArrayList<>();
    private ResendClient client;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            paths.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            received.add(JSON.readTree(exchange.getRequestBody().readAllBytes()));
            authHeaders.add(exchange.getRequestHeaders().getFirst("Authorization"));
            idempotencyKeys.add(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
            int status = statuses.size() > 1 ? statuses.poll()[0] : statuses.isEmpty() ? 200 : statuses.peek()[0];
            String body = bodies.size() > 1 ? bodies.poll() : bodies.isEmpty() ? "{\"id\":\"abc\"}" : bodies.peek();
            byte[] out = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
        client = new ResendClient(KEY, "http://127.0.0.1:" + server.getAddress().getPort());
    }

    @AfterEach
    void stop() { server.stop(0); }

    private void answer(int status, String body) { statuses.add(new int[] {status}); bodies.add(body); }

    private MailService service() {
        @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> none = mock(ObjectProvider.class);
        return new MailService(none, TestSupport.props(), "no-reply@speak.example", client);
    }

    private static String error(String name, String message) { return "{\"statusCode\":0,\"name\":\"" + name + "\",\"message\":\"" + message + "\"}"; }

    // --- request shape ------------------------------------------------------------------------------------------------------------

    @Test
    void aVerificationEmailIsPostedToTheEmailsEndpointWithTheKeyOnlyInTheAuthorizationHeader() {
        service().sendVerificationEmail("ana@example.com", "tok123", "482913");
        assertThat(paths).containsExactly("POST /emails");
        assertThat(authHeaders).containsExactly("Bearer " + KEY);
        JsonNode body = received.get(0);
        assertThat(body.get("from").asText()).contains(TestSupport.props().name()).contains("<no-reply@speak.example>");
        assertThat(body.get("to").get(0).asText()).isEqualTo("ana@example.com");
        assertThat(body.get("subject").asText()).contains("Verify");
        assertThat(body.get("text").asText()).contains("482913");   // the existing template, unchanged
        assertThat(body.has("html")).isFalse();                       // plain text by default, as with SMTP
        assertThat(body.toString()).doesNotContain(KEY);
        assertThat(idempotencyKeys.get(0)).isNotBlank();
    }

    @Test
    void thePasswordResetEmailUsesTheSameTemplateAsBefore() {
        service().sendPasswordResetEmail("ana@example.com", "tok", "135790");
        assertThat(received.get(0).get("subject").asText()).containsIgnoringCase("reset");
        assertThat(received.get(0).get("text").asText()).contains("135790");
    }

    @Test
    void theSenderDisplayNameIsAlwaysTheApplicationNameWhateverMailFromHolds() {
        @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> none = mock(ObjectProvider.class);
        new MailService(none, TestSupport.props(), "Some Developer <onboarding@resend.dev>", client).sendVerificationEmail("ana@example.com", "t", "123456");
        String from = received.get(0).get("from").asText();
        assertThat(from).contains("<onboarding@resend.dev>").doesNotContain("Some Developer").contains(TestSupport.props().name());
    }

    // --- errors and retries -------------------------------------------------------------------------------------------------------

    @Test
    void aRefusedKeyIsReportedAsALoginProblemAndNotRetried() {
        answer(401, error("invalid_api_key", "API key is invalid"));
        Throwable t = catchThrowable(() -> service().sendVerificationEmail("ana@example.com", "t", "123456"));
        assertThat(t).isInstanceOf(MailDeliveryException.class);
        assertThat(((MailDeliveryException) t).kind()).isEqualTo(MailDeliveryException.Kind.LOGIN_REFUSED);
        assertThat(received).hasSize(1);
        assertThat(t.getMessage() + " " + String.valueOf(t.getCause())).doesNotContain(KEY);
    }

    @Test
    void theFreeTierTestingRestrictionIsARecipientRefusalAndNotRetried() {
        answer(403, error("validation_error", "You can only send testing emails to your own email address (owner@example.com)."));
        MailDeliveryException e = (MailDeliveryException) catchThrowable(() -> service().sendVerificationEmail("other@example.com", "t", "123456"));
        assertThat(e.kind()).isEqualTo(MailDeliveryException.Kind.RECIPIENT_REFUSED);
        assertThat(received).hasSize(1);
        assertThat(e.getMessage()).doesNotContain("owner@example.com"); // Resend's free-text message is never copied into ours
    }

    @Test
    void anUnverifiedDomainIsASenderRefusal() {
        answer(403, error("validation_error", "The speak.example domain is not verified."));
        MailDeliveryException e = (MailDeliveryException) catchThrowable(() -> service().sendVerificationEmail("ana@example.com", "t", "123456"));
        assertThat(e.kind()).isEqualTo(MailDeliveryException.Kind.SENDER_REFUSED);
    }

    @Test
    void anInvalidRecipientIsRefusedWithoutRetry() {
        answer(422, error("invalid_to_address", "Invalid `to` field."));
        MailDeliveryException e = (MailDeliveryException) catchThrowable(() -> service().sendVerificationEmail("bad", "t", "123456"));
        assertThat(e.kind()).isEqualTo(MailDeliveryException.Kind.RECIPIENT_REFUSED);
        assertThat(received).hasSize(1);
    }

    @Test
    void aRateLimitIsRetriedOnceWithTheSameIdempotencyKeyAndThenSucceeds() {
        answer(429, error("rate_limit_exceeded", "Too many requests"));
        answer(200, "{\"id\":\"abc\"}");
        service().sendVerificationEmail("ana@example.com", "t", "123456");
        assertThat(received).hasSize(2);
        assertThat(idempotencyKeys.get(0)).isEqualTo(idempotencyKeys.get(1)); // a retry cannot deliver the code twice
    }

    @Test
    void aResendOutageIsRetriedThenReportedToThePerson() {
        answer(503, error("application_error", "down"));
        MailDeliveryException e = (MailDeliveryException) catchThrowable(() -> service().sendVerificationEmail("ana@example.com", "t", "123456"));
        assertThat(e.kind()).isEqualTo(MailDeliveryException.Kind.OTHER);
        assertThat(received).hasSize(2); // the person-facing path makes 2 attempts
    }

    @Test
    void anUnreachableResendIsAConnectionFailure() {
        client = new ResendClient(KEY, "http://127.0.0.1:1"); // nothing listens there
        MailDeliveryException e = (MailDeliveryException) catchThrowable(() -> service().sendVerificationEmail("ana@example.com", "t", "123456"));
        assertThat(e.kind()).isEqualTo(MailDeliveryException.Kind.CONNECTION);
    }

    @Test
    void anAnswerThatIsNotJsonStillHasAStatus() {
        answer(500, "<html>bad gateway</html>");
        assertThat(ResendClient.failure(500, "<html>bad gateway</html>").isTransientFailure()).isTrue();
        assertThat(ResendClient.failure(400, null).isTransientFailure()).isFalse();
    }

    // --- precedence ---------------------------------------------------------------------------------------------------------------

    @Test
    void resendIsUsedInsteadOfSmtpWhenBothAreConfigured() throws Exception {
        JavaMailSender smtp = mock(JavaMailSender.class);
        @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(smtp);
        MailService both = new MailService(provider, TestSupport.props(), "no-reply@speak.example", client);
        both.sendVerificationEmail("ana@example.com", "t", "123456");
        assertThat(received).hasSize(1);
        verify(smtp, never()).send(org.mockito.ArgumentMatchers.any(jakarta.mail.internet.MimeMessage.class));
        assertThat(both.providerName()).isEqualTo("Resend");
        assertThat(both.isConfigured()).isTrue();
    }

    @Test
    void smtpIsStillUsedWhenThereIsNoResendKey() {
        @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(mock(JavaMailSender.class));
        MailService smtpOnly = new MailService(provider, TestSupport.props(), "no-reply@speak.example");
        assertThat(smtpOnly.providerName()).isEqualTo("SMTP");
        assertThat(smtpOnly.isConfigured()).isTrue();
    }

    @Test
    void theAdminTestEmailGoesThroughResendAndReportsAFailureWithoutTheKey() {
        service().sendChecked("admin@example.com", "Test", "body");
        assertThat(received).hasSize(1);
        answer(401, error("invalid_api_key", "bad"));
        assertThatThrownBy(() -> service().sendChecked("admin@example.com", "Test", "body"))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("401").hasMessageNotContaining(KEY);
    }

    // --- logging ------------------------------------------------------------------------------------------------------------------

    @Test
    void neitherTheKeyNorTheCodeNorTheLinkIsEverLogged() {
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(MailService.class);
        var appender = new ListAppender<ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        try {
            service().sendVerificationEmail("ana@example.com", "secrettoken", "918273");
            answer(401, error("invalid_api_key", "bad"));
            catchThrowable(() -> service().sendPasswordResetEmail("ana@example.com", "othersecret", "564738"));
            List<String> lines = new ArrayList<>();
            appender.list.forEach(e -> { lines.add(e.getFormattedMessage()); if (e.getThrowableProxy() != null) lines.add(e.getThrowableProxy().getMessage()); });
            String logged = String.join("\n", lines);
            assertThat(logged).contains("via Resend").contains("HTTP 401 (invalid_api_key)")
                    .doesNotContain(KEY).doesNotContain("918273").doesNotContain("secrettoken").doesNotContain("564738").doesNotContain("othersecret");
        } finally {
            logger.detachAppender(appender);
        }
    }

    @Test
    void theClientNeverPrintsItsKey() {
        assertThat(client.toString()).doesNotContain(KEY).contains("***");
    }

    // --- configuration validation -------------------------------------------------------------------------------------------------

    @Test
    void aKeyWithSpacesQuotesOrLineBreaksIsRejectedWithoutEchoingIt() {
        for (String bad : new String[] {"re_abc def", "\"re_abcdef\"", "re_abc\ndef", "", "   "}) {
            Throwable t = catchThrowable(() -> ResendConfig.validatedKey(bad));
            assertThat(t).isInstanceOf(IllegalStateException.class).hasMessageContaining("RESEND_API_KEY");
            assertThat(t.getMessage()).doesNotContain("abcdef").doesNotContain("abc def");
        }
        assertThat(ResendConfig.validatedKey("  re_goodkey123  ")).isEqualTo("re_goodkey123");
    }

    @Test
    void theResendTestSenderIsRecognised() {
        assertThat(ResendConfig.usesResendTestSender("onboarding@resend.dev")).isTrue();
        assertThat(ResendConfig.usesResendTestSender("Speakora <onboarding@resend.dev>")).isTrue();
        assertThat(ResendConfig.usesResendTestSender("no-reply@speak.example")).isFalse();
        assertThat(MailService.isPlaceholderSender("onboarding@resend.dev")).isFalse(); // allowed in production while testing
    }
}
