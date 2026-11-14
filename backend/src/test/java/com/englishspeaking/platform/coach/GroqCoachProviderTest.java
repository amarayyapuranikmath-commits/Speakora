package com.englishspeaking.platform.coach;

import com.englishspeaking.platform.security.AppProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Exercises the real HTTP client against a local stand-in that speaks Groq's OpenAI-compatible wire format (mocked responses).
 * This does NOT prove behaviour against the live Groq API.
 */
class GroqCoachProviderTest {
    private static final String KEY = "gsk_test_key_value_1234567890";
    private final ObjectMapper mapper = new ObjectMapper();
    private HttpServer server;
    private final List<String> authHeaders = new CopyOnWriteArrayList<>();
    private final List<String> paths = new CopyOnWriteArrayList<>();
    private final List<JsonNode> bodies = new CopyOnWriteArrayList<>();
    /** One scripted answer per request, in order; the last one repeats. */
    private final ConcurrentLinkedQueue<Reply> script = new ConcurrentLinkedQueue<>();
    private volatile Reply last;

    /** @param chunks when set, the body is streamed as these raw SSE strings with {@code gapMs} between them */
    record Reply(int status, String body, List<String> chunks, long headerDelayMs, long gapMs, Map<String, String> headers) {
        static Reply json(int status, String body) { return new Reply(status, body, null, 0, 0, Map.of()); }
        static Reply sse(String... chunks) { return new Reply(200, null, List.of(chunks), 0, 0, Map.of()); }
        Reply gap(long ms) { return new Reply(status, body, chunks, headerDelayMs, ms, headers); }
        Reply delayHeaders(long ms) { return new Reply(status, body, chunks, ms, gapMs, headers); }
        Reply header(String k, String v) { return new Reply(status, body, chunks, headerDelayMs, gapMs, Map.of(k, v)); }
    }

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/openai/v1/chat/completions", this::handle);
        server.start();
    }

    @AfterEach
    void stop() { server.stop(0); }

    private void handle(HttpExchange ex) throws IOException {
        authHeaders.add(String.valueOf(ex.getRequestHeaders().getFirst("Authorization")));
        paths.add(ex.getRequestURI().getPath());
        bodies.add(mapper.readTree(ex.getRequestBody().readAllBytes()));
        Reply r = script.poll();
        if (r == null) r = last; else last = r;
        try {
            if (r.headerDelayMs() > 0) Thread.sleep(r.headerDelayMs());
            r.headers().forEach((k, v) -> ex.getResponseHeaders().add(k, v));
            if (r.chunks() == null) {
                byte[] out = r.body().getBytes(StandardCharsets.UTF_8);
                ex.getResponseHeaders().add("content-type", "application/json");
                ex.sendResponseHeaders(r.status(), out.length);
                ex.getResponseBody().write(out);
            } else {
                ex.getResponseHeaders().add("content-type", "text/event-stream");
                ex.sendResponseHeaders(r.status(), 0);
                OutputStream os = ex.getResponseBody();
                for (String c : r.chunks()) {
                    os.write(c.getBytes(StandardCharsets.UTF_8));
                    os.flush();
                    if (r.gapMs() > 0) Thread.sleep(r.gapMs());
                }
            }
        } catch (InterruptedException | IOException ignored) {
            // the client gave up (a timeout or abandon test)
        } finally {
            ex.close();
        }
    }

    private GroqCoachProvider provider(String key) { return provider(key, Duration.ofSeconds(5), Duration.ofSeconds(5)); }

    private GroqCoachProvider provider(String key, Duration requestTimeout, Duration streamDeadline) {
        var coach = new AppProperties.Coach(key, "openai/gpt-oss-120b", "http://127.0.0.1:" + server.getAddress().getPort() + "/openai/v1/", 20);
        return new GroqCoachProvider(new AppProperties("n", "u", "o", new AppProperties.Jwt("x".repeat(32), 15), 30, false,
                new AppProperties.Turn(), "", coach), mapper, requestTimeout, streamDeadline, Duration.ofSeconds(2));
    }

    private static String completion(String content) {
        return "{\"id\":\"x\",\"choices\":[{\"index\":0,\"finish_reason\":\"stop\",\"message\":{\"role\":\"assistant\",\"content\":" + quote(content) + ",\"reasoning\":\"hidden thoughts\"}}]}";
    }

    private static String quote(String s) { return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""; }

    private static String delta(String json) { return "data: {\"choices\":[{\"index\":0,\"delta\":" + json + "}]}\n\n"; }

    private static String text(String piece) { return delta("{\"content\":" + quote(piece) + "}"); }

    private static List<TutorService.Turn> turns(String... roleAndText) {
        List<TutorService.Turn> out = new ArrayList<>();
        for (int i = 0; i < roleAndText.length; i += 2) out.add(new TutorService.Turn(roleAndText[i], roleAndText[i + 1]));
        return out;
    }

    @Test
    void withoutAKeyItIsNotConfiguredAndNeverCallsOut() {
        var p = provider("");
        assertThat(p.isConfigured()).isFalse();
        assertThatThrownBy(() -> p.chat("sys", turns("user", "hi")))
                .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> assertThat(e.kind()).isEqualTo(CoachProvider.Kind.UNAVAILABLE));
        assertThatThrownBy(() -> p.chat("sys", turns("user", "hi"))).isInstanceOf(CoachProvider.CoachException.class);
        assertThatThrownBy(() -> p.chatStream("sys", turns("user", "hi"), s -> { })).isInstanceOf(CoachProvider.CoachException.class);
        assertThat(bodies).isEmpty();
    }

    // ---------------------------------------------------------------------------------------------- chat

    @Test
    void chatSendsTheSystemPromptFirstThenTheTurnsAndReadsTheContentNotTheReasoning() {
        script.add(Reply.json(200, completion("  Hello there!  ")));
        String reply = provider(KEY).chat("SYSTEM PROMPT", turns("user", "Hi", "assistant", "Hello", "user", "What is a verb?"));
        assertThat(reply).isEqualTo("Hello there!");
        JsonNode m = bodies.get(0).get("messages");
        assertThat(m).hasSize(4);
        assertThat(m.get(0).get("role").asText()).isEqualTo("system");
        assertThat(m.get(0).get("content").asText()).isEqualTo("SYSTEM PROMPT");
        assertThat(m.get(1).get("role").asText()).isEqualTo("user");
        assertThat(m.get(2).get("role").asText()).isEqualTo("assistant");
        assertThat(m.get(3).get("content").asText()).isEqualTo("What is a verb?");
        assertThat(bodies.get(0).get("max_completion_tokens").asInt()).isGreaterThanOrEqualTo(1000);
        assertThat(bodies.get(0).get("reasoning_effort").asText()).isEqualTo("low");
    }

    @Test
    void anEmptyReplyIsAnErrorAndATruncatedOneSaysWhy() {
        script.add(Reply.json(200, "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"\"}}]}"));
        assertThatThrownBy(() -> provider(KEY).chat("s", turns("user", "hi"))).hasMessageContaining("empty");
        script.add(Reply.json(200, "{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":null,\"reasoning\":\"long thoughts\"}}]}"));
        assertThatThrownBy(() -> provider(KEY).chat("s", turns("user", "hi"))).hasMessageContaining("ran out of room");
    }

    // ---------------------------------------------------------------------------------------------- streaming

    @Test
    void streamedRepliesDeliverContentPiecesInOrderAndIgnoreReasoningRoleAndUsageChunks() {
        script.add(Reply.sse(
                delta("{\"role\":\"assistant\",\"content\":\"\"}"),
                delta("{\"reasoning\":\"thinking about tenses\"}"),
                text("Good "), text("question"), text("! "),
                "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
                "data: {\"choices\":[],\"usage\":{\"total_tokens\":42}}\n\n",
                "data: [DONE]\n\n"));
        List<String> pieces = new ArrayList<>();
        String reply = provider(KEY).chatStream("SYS", turns("user", "Hi"), pieces::add);
        assertThat(pieces).containsExactly("Good ", "question", "! ");
        assertThat(reply).isEqualTo("Good question!");
        assertThat(bodies.get(0).get("stream").asBoolean()).isTrue();
        assertThat(authHeaders).containsExactly("Bearer " + KEY);
    }

    @Test
    void piecesArriveWhileTheReplyIsStillBeingWritten() {
        script.add(Reply.sse(text("First "), text("second "), text("third")).gap(150));
        List<Long> arrival = new CopyOnWriteArrayList<>();
        long t0 = System.nanoTime();
        provider(KEY).chatStream("SYS", turns("user", "Hi"), p -> arrival.add((System.nanoTime() - t0) / 1_000_000));
        assertThat(arrival).hasSize(3);
        assertThat(arrival.get(2) - arrival.get(0)).as("pieces are spread over time, not delivered in one lump").isGreaterThanOrEqualTo(200);
    }

    @Test
    void aStreamThatEndsWithoutContentIsAnError() {
        script.add(Reply.sse(delta("{\"reasoning\":\"only thoughts\"}"), "data: [DONE]\n\n"));
        assertThatThrownBy(() -> provider(KEY).chatStream("SYS", turns("user", "Hi"), s -> { })).hasMessageContaining("empty");
    }

    @Test
    void anErrorEventInTheMiddleOfAStreamFailsAfterTheEarlierPiecesWereDelivered() {
        script.add(Reply.sse(text("Half "), "data: {\"error\":{\"message\":\"echo of learner text\",\"code\":\"rate_limit_exceeded\"}}\n\n"));
        List<String> pieces = new ArrayList<>();
        assertThatThrownBy(() -> provider(KEY).chatStream("SYS", turns("user", "Hi"), pieces::add))
                .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> {
                    assertThat(e.kind()).isEqualTo(CoachProvider.Kind.RATE_LIMITED);
                    assertThat(e.getMessage()).doesNotContain("echo");
                });
        assertThat(pieces).containsExactly("Half ");
    }

    @Test
    void whenTheCallerStopsReceivingTheStreamIsAbandonedAndTheCallersExceptionPropagates() {
        script.add(Reply.sse(text("One "), text("two "), text("three ")).gap(50));
        class Gone extends RuntimeException { }
        Consumer<String> sink = p -> { throw new Gone(); };
        assertThatThrownBy(() -> provider(KEY).chatStream("SYS", turns("user", "Hi"), sink)).isInstanceOf(Gone.class);
    }

    @Test
    void aStreamThatStallsIsCutOffWithATimeout() {
        script.add(Reply.sse(text("Start "), text("never finishes")).gap(5_000));
        List<String> pieces = new ArrayList<>();
        assertThatThrownBy(() -> provider(KEY, Duration.ofSeconds(5), Duration.ofMillis(600)).chatStream("SYS", turns("user", "Hi"), pieces::add))
                .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> assertThat(e.kind()).isEqualTo(CoachProvider.Kind.TIMEOUT));
        assertThat(pieces).containsExactly("Start ");
    }

    @Test
    void streamingRetriesOnceOnARateLimitThenSucceeds() {
        script.add(Reply.json(429, "{\"error\":{\"message\":\"slow down\",\"code\":\"rate_limit_exceeded\"}}").header("retry-after", "0"));
        script.add(Reply.sse(text("Fine"), "data: [DONE]\n\n"));
        assertThat(provider(KEY).chatStream("SYS", turns("user", "Hi"), s -> { })).isEqualTo("Fine");
        assertThat(bodies).hasSize(2);
    }

    @Test
    void streamingRateLimitThatPersistsIsReportedAsBusy() {
        script.add(Reply.json(429, "{\"error\":{\"message\":\"echo\",\"code\":\"rate_limit_exceeded\"}}").header("retry-after", "0"));
        assertThatThrownBy(() -> provider(KEY).chatStream("SYS", turns("user", "Hi"), s -> { }))
                .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> assertThat(e.kind()).isEqualTo(CoachProvider.Kind.RATE_LIMITED));
        assertThat(bodies).hasSize(2); // exactly one retry
    }

    @Test
    void streamingFallsBackToAPlainRequestWhenTheModelRejectsTheTuningParameter() {
        script.add(Reply.json(400, "{\"error\":{\"message\":\"reasoning_effort is not supported\",\"code\":\"invalid_request\"}}"));
        script.add(Reply.sse(text("Works"), "data: [DONE]\n\n"));
        assertThat(provider(KEY).chatStream("SYS", turns("user", "Hi"), s -> { })).isEqualTo("Works");
        assertThat(bodies.get(0).has("reasoning_effort")).isTrue();
        assertThat(bodies.get(1).has("reasoning_effort")).isFalse();
    }

    // ---------------------------------------------------------------------------------------------- errors (plain requests)

    @Test
    void aRateLimitIsRetriedOnceHonouringRetryAfterAndThenSucceeds() {
        script.add(Reply.json(429, "{\"error\":{\"code\":\"rate_limit_exceeded\"}}").header("retry-after", "1"));
        script.add(Reply.json(200, completion("OK")));
        long t0 = System.nanoTime();
        assertThat(provider(KEY).chat("s", turns("user", "hi"))).isEqualTo("OK");
        assertThat(bodies).hasSize(2);
        assertThat((System.nanoTime() - t0) / 1_000_000).as("the provider's one-second wait is honoured").isGreaterThanOrEqualTo(900);
    }

    @Test
    void aRateLimitThatAsksForALongWaitIsNotHitAgainAndCarriesTheWait() {
        script.add(Reply.json(429, "{\"error\":{\"code\":\"rate_limit_exceeded\"}}").header("retry-after", "42"));
        assertThatThrownBy(() -> provider(KEY).chat("s", turns("user", "hi")))
                .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> {
                    assertThat(e.kind()).isEqualTo(CoachProvider.Kind.RATE_LIMITED);
                    assertThat(e.retryAfterSeconds()).isEqualTo(42);
                });
        assertThat(bodies).as("no pointless second request that would only use more quota").hasSize(1);
    }

    @Test
    void aLongRateLimitWaitIsAlsoNotRetriedWhileStreaming() {
        script.add(Reply.json(429, "{}").header("retry-after", "7.2"));
        assertThatThrownBy(() -> provider(KEY).chatStream("s", turns("user", "hi"), x -> { }))
                .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> assertThat(e.retryAfterSeconds()).isEqualTo(8)); // rounded up
        assertThat(bodies).hasSize(1);
    }

    @Test
    void aPersistentRateLimitIsReportedAsBusyWithoutLeakingTheBody() {
        script.add(Reply.json(429, "{\"error\":{\"message\":\"echoed learner text here\",\"code\":\"rate_limit_exceeded\"}}"));
        assertThatThrownBy(() -> provider(KEY).chat("s", turns("user", "hi")))
                .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> {
                    assertThat(e.kind()).isEqualTo(CoachProvider.Kind.RATE_LIMITED);
                    assertThat(e.getMessage()).doesNotContain("echoed");
                });
        assertThat(bodies).hasSize(2);
    }

    @Test
    void aRejectedKeyOrAMissingOrRetiredModelIsReportedAsUnavailable() {
        for (Reply r : List.of(Reply.json(401, "{\"error\":{\"code\":\"invalid_api_key\"}}"), Reply.json(403, "{}"), Reply.json(404, "{\"error\":{\"code\":\"model_not_found\"}}"),
                Reply.json(400, "{\"error\":{\"code\":\"model_decommissioned\",\"message\":\"echo\"}}"))) {
            bodies.clear();
            script.clear();
            last = null;
            script.add(r);
            assertThatThrownBy(() -> provider(KEY).chat("s", turns("user", "hi")))
                    .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> assertThat(e.kind()).as("status %d", r.status()).isEqualTo(CoachProvider.Kind.UNAVAILABLE));
            assertThat(bodies).as("status %d", r.status()).hasSizeLessThanOrEqualTo(2); // at most the one untuned retry for a 400
        }
    }

    @Test
    void serverErrorsAreRetriedOnceThenReportedAsAFailure() {
        script.add(Reply.json(500, "{\"error\":{\"message\":\"echoed learner text here\"}}"));
        assertThatThrownBy(() -> provider(KEY).chat("s", turns("user", "hi")))
                .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> {
                    assertThat(e.kind()).isEqualTo(CoachProvider.Kind.FAILED);
                    assertThat(e.getMessage()).doesNotContain("echoed");
                });
        assertThat(bodies).hasSize(2);
    }

    @Test
    void aProviderThatDoesNotAnswerInTimeIsReportedAsATimeout() {
        script.add(Reply.json(200, completion("too late")).delayHeaders(1_500));
        assertThatThrownBy(() -> provider(KEY, Duration.ofMillis(300), Duration.ofSeconds(5)).chat("s", turns("user", "hi")))
                .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> assertThat(e.kind()).isEqualTo(CoachProvider.Kind.TIMEOUT));
        assertThat(bodies).hasSize(1); // a timeout is not retried: the learner would wait twice as long
    }

    @Test
    void errorsNeverContainTheKey() {
        script.add(Reply.json(401, "{\"error\":{\"code\":\"invalid_api_key\"}}"));
        assertThatThrownBy(() -> provider(KEY).chat("s", turns("user", "hi"))).hasMessageNotContaining(KEY);
        assertThat(new AppProperties.Coach(KEY, "m", "u", 1).toString()).doesNotContain(KEY).contains("***");
    }

    // ---------------------------------------------------------------------------------------------- wire-format helpers

    @Test
    void streamedLinesAreReadAsServerSentEvents() throws Exception {
        var p = provider(KEY);
        assertThat(p.streamedText("data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}")).isEqualTo("Hel");
        assertThat(p.streamedText("data: {\"choices\":[{\"delta\":{\"content\":\"\"}}]}")).isEmpty();
        assertThat(p.streamedText("data: {\"choices\":[{\"delta\":{\"reasoning\":\"x\"}}]}")).isNull();
        assertThat(p.streamedText("data: {\"choices\":[{\"delta\":{\"content\":null}}]}")).isNull();
        assertThat(p.streamedText("data: {\"choices\":[]}")).isNull();
        assertThat(p.streamedText("data: [DONE]")).isNull();
        assertThat(p.streamedText(": keep-alive")).isNull();
        assertThat(p.streamedText("")).isNull();
    }

    // ---- a pasted key or URL that the JDK would refuse must neither crash the request nor leak into messages

    private GroqCoachProvider providerWith(String key, String baseUrl) {
        var coach = new AppProperties.Coach(key, "openai/gpt-oss-120b", baseUrl, 20);
        return new GroqCoachProvider(new AppProperties("n", "u", "o", new AppProperties.Jwt("x".repeat(32), 15), 30, false,
                new AppProperties.Turn(), "", coach), mapper, Duration.ofSeconds(5), Duration.ofSeconds(5), Duration.ofSeconds(2));
    }

    private String serverUrl() { return "http://127.0.0.1:" + server.getAddress().getPort() + "/openai/v1"; }

    @Test
    void aKeyPastedWithALineBreakOrSpacesIsCleanedAndStillWorksForStreamingAndPlainReplies() {
        script.add(Reply.sse(text("Hello"), "data: [DONE]\n\n"));
        List<String> pieces = new ArrayList<>();
        assertThat(providerWith("  " + KEY + "\r\n", serverUrl()).chatStream("SYS", turns("user", "Hi"), pieces::add)).isEqualTo("Hello");
        script.add(Reply.json(200, completion("Hi there")));
        assertThat(providerWith(KEY + "\n", serverUrl() + "/ ").chat("SYS", turns("user", "Hi"))).isEqualTo("Hi there");
        assertThat(authHeaders).containsExactly("Bearer " + KEY, "Bearer " + KEY);
    }

    @Test
    void aKeyWithAnInvalidCharacterAnswersUnavailableWithoutBuildingARequestOrRevealingTheKey() {
        String bad = "gsk_SECRETVALUE…tail"; // a non-ASCII character in the middle survives trimming
        for (String key : new String[] {bad, "gsk_SECRET VALUE", "\"gsk_SECRETVALUE\""}) {
            GroqCoachProvider p = providerWith(key, serverUrl());
            assertThat(p.isConfigured()).isTrue();
            assertThatThrownBy(() -> p.chatStream("SYS", turns("user", "Hi"), s -> { }))
                    .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> {
                        assertThat(e.kind()).isEqualTo(CoachProvider.Kind.UNAVAILABLE);
                        assertThat(e.getMessage()).contains("GROQ_API_KEY").doesNotContain("SECRET");
                        assertThat(e.getCause()).isNull();
                    });
            assertThatThrownBy(() -> p.chat("SYS", turns("user", "Hi"))).isInstanceOf(CoachProvider.CoachException.class).hasMessageNotContaining("SECRET");
        }
        assertThat(authHeaders).isEmpty(); // nothing was sent to the provider
    }

    @Test
    void aBadBaseUrlAnswersUnavailableAndNamesTheSettingNotTheValue() {
        for (String url : new String[] {"api.groq.com/openai/v1", "https://api groq.com/v1", "", "ftp://x.test/v1"}) {
            GroqCoachProvider p = providerWith(KEY, url);
            assertThatThrownBy(() -> p.chatStream("SYS", turns("user", "Hi"), s -> { }))
                    .isInstanceOfSatisfying(CoachProvider.CoachException.class, e -> {
                        assertThat(e.kind()).isEqualTo(CoachProvider.Kind.UNAVAILABLE);
                        assertThat(e.getMessage()).contains("GROQ_BASE_URL").doesNotContain(KEY);
                    });
        }
    }

    @Test
    void problemWithAcceptsARealKeyAndUrl() {
        assertThat(GroqCoachProvider.problemWith(KEY, "https://api.groq.com/openai/v1")).isNull();
        assertThat(GroqCoachProvider.problemWith(KEY, "http://127.0.0.1:8080/openai/v1")).isNull();
    }
}
