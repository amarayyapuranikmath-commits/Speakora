package com.englishspeaking.platform.coach;

import com.englishspeaking.platform.security.AppProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * The AI provider: Groq's OpenAI-compatible chat completions API ({@code POST {base}/chat/completions}, bearer key, server-sent
 * events when {@code stream} is true). The key comes from {@code GROQ_API_KEY} and is only ever sent in the Authorization header.
 * Reasoning text that gpt-oss models may return is never shown or stored: only {@code content} is used. Error bodies are never
 * logged or returned, because they can echo the learner's text; only the HTTP status and a short error code are logged.
 */
@Component
public class GroqCoachProvider implements CoachProvider {
    private static final Logger log = LoggerFactory.getLogger(GroqCoachProvider.class);
    private static final Pattern SAFE_CODE = Pattern.compile("[a-z0-9_.-]{1,40}");
    private final AppProperties.Coach config;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final Duration requestTimeout;
    private final Duration streamDeadline;
    private final Duration maxRetryWait;
    private final String apiKey;       // GROQ_API_KEY with surrounding whitespace removed (a pasted trailing newline is the usual accident)
    private final String baseUrl;      // GROQ_BASE_URL, trimmed, without a trailing slash
    private final String configProblem; // null when the key and the URL can be used; a value-free description otherwise

    @Autowired
    public GroqCoachProvider(AppProperties props, ObjectMapper mapper) {
        this(props, mapper, Duration.ofSeconds(60), Duration.ofSeconds(90), Duration.ofSeconds(3));
    }

    /** Timeouts are parameters so tests can exercise them quickly. */
    GroqCoachProvider(AppProperties props, ObjectMapper mapper, Duration requestTimeout, Duration streamDeadline, Duration maxRetryWait) {
        this.config = props.coach();
        this.mapper = mapper;
        this.requestTimeout = requestTimeout;
        this.streamDeadline = streamDeadline;
        this.maxRetryWait = maxRetryWait;
        this.apiKey = config.apiKey() == null ? "" : config.apiKey().strip();
        this.baseUrl = stripSlash(config.baseUrl() == null ? "" : config.baseUrl().strip());
        this.configProblem = config.configured() ? problemWith(apiKey, baseUrl) : null;
        if (configProblem != null) log.error("The AI coach is switched off: {} (the value is not shown).", configProblem);
    }

    /**
     * Why the key or URL cannot be put into a request, without ever repeating them. The JDK refuses a header value with a line break or a
     * non-ASCII character and refuses a URL it cannot parse, and its message includes the value (our API key), so the request is never built
     * from such values.
     */
    static String problemWith(String key, String url) {
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            if (c < 0x21 || c > 0x7e) return "GROQ_API_KEY contains a space, line break or non-ASCII character; paste only the key itself";
        }
        if (key.startsWith("\"") || key.startsWith("'")) return "GROQ_API_KEY starts with a quote; paste only the key itself, without quotes";
        try {
            java.net.URI uri = new java.net.URI(url);
            boolean web = "https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme());
            if (!web || uri.getHost() == null) return "GROQ_BASE_URL is not a full http(s) URL such as https://api.groq.com/openai/v1";
        } catch (java.net.URISyntaxException e) {
            return "GROQ_BASE_URL is not a valid URL (check for spaces or stray characters)";
        }
        return null;
    }

    @Override
    public boolean isConfigured() { return config.configured(); }

    @Override
    public String modelName() { return config.model(); }

    // ------------------------------------------------------------------------------------------------ chat

    @Override
    public String chat(String system, List<TutorService.Turn> turns) {
        requireConfigured();
        try {
            return replyText(post(completionBody(messages(system, turns), 0.5, 1500, false)));
        } catch (IOException e) {
            throw new CoachException("The tutor returned an unreadable reply.", e);
        }
    }

    @Override
    public String chatStream(String system, List<TutorService.Turn> turns, Consumer<String> onDelta) {
        requireConfigured();
        Map<String, Object> body = completionBody(messages(system, turns), 0.5, 1500, true);
        boolean retried = false;
        boolean untuned = false;
        for (;;) {
            LineCollector collector = new LineCollector(onDelta);
            CompletableFuture<HttpResponse<Void>> response = http.sendAsync(request(body, "text/event-stream"),
                    info -> info.statusCode() / 100 == 2
                            ? HttpResponse.BodySubscribers.fromLineSubscriber(collector, c -> (Void) null, StandardCharsets.UTF_8, null)
                            : HttpResponse.BodySubscribers.<Void>discarding());
            int status;
            java.net.http.HttpHeaders headers;
            try {
                CompletableFuture.anyOf(response, collector.finished).get(streamDeadline.toMillis(), TimeUnit.MILLISECONDS);
                if (collector.failure != null) {
                    response.cancel(true);
                    if (collector.failure instanceof CoachException ce) throw ce;
                    if (collector.failure instanceof RuntimeException re) throw re; // e.g. the learner left: the caller decides
                    throw new CoachException("The tutor reply was interrupted.", collector.failure);
                }
                HttpResponse<Void> done = response.get(5, TimeUnit.SECONDS);
                status = done.statusCode();
                headers = done.headers();
            } catch (TimeoutException e) {
                response.cancel(true);
                collector.cancel();
                log.warn("Groq stream exceeded {} s", streamDeadline.toSeconds());
                throw new CoachException(Kind.TIMEOUT, "The tutor took too long to answer.", e);
            } catch (ExecutionException e) {
                Throwable cause = e.getCause();
                if (cause instanceof HttpTimeoutException) throw new CoachException(Kind.TIMEOUT, "The tutor took too long to answer.", cause);
                if (!collector.started && !retried) { retried = true; continue; } // dropped before anything arrived: one more try
                throw new CoachException("The tutor provider could not be reached.", cause);
            } catch (InterruptedException e) {
                response.cancel(true);
                Thread.currentThread().interrupt();
                throw new CoachException("The request was interrupted.", e);
            }
            if (status / 100 != 2) {
                log.warn("Groq returned HTTP {}", status);
                if (status == 400 && !untuned) { body = untuned(body); untuned = true; continue; }
                int wait = retryAfterSeconds(headers);
                if (!retried && isTransient(status) && worthRetrying(status, wait)) { retried = true; pause(wait); continue; }
                throw failure(status, null, wait);
            }
            String reply = collector.text.toString().strip();
            if (reply.isEmpty()) throw new CoachException("The tutor returned an empty reply.");
            return reply;
        }
    }

    /** Receives the lines of a streamed reply on the HTTP client's thread and hands text pieces to the caller as they arrive. */
    private final class LineCollector implements Flow.Subscriber<String> {
        final StringBuilder text = new StringBuilder();
        final CompletableFuture<Void> finished = new CompletableFuture<>();
        private final Consumer<String> onDelta;
        private volatile Flow.Subscription subscription;
        volatile Throwable failure;
        volatile boolean started;

        LineCollector(Consumer<String> onDelta) { this.onDelta = onDelta; }

        @Override public void onSubscribe(Flow.Subscription s) { subscription = s; s.request(Long.MAX_VALUE); }

        @Override public void onNext(String line) {
            try {
                String piece = streamedText(line);
                if (piece == null || piece.isEmpty()) return;
                started = true;
                text.append(piece);
                onDelta.accept(piece);
            } catch (Throwable t) { // includes the caller's own signal that the learner left
                failure = t;
                cancel();
                finished.complete(null);
            }
        }

        @Override public void onError(Throwable t) { failure = t; finished.complete(null); }

        @Override public void onComplete() { finished.complete(null); }

        void cancel() { Flow.Subscription s = subscription; if (s != null) s.cancel(); }
    }

    /** The text carried by one server-sent-events line of a streamed reply, or null for lines that carry none. */
    String streamedText(String line) throws IOException {
        if (!line.startsWith("data:")) return null;
        String data = line.substring(5).strip();
        if (data.isEmpty() || data.equals("[DONE]")) return null;
        JsonNode node = mapper.readTree(data);
        if (node.hasNonNull("error")) {
            String code = node.path("error").path("code").asText("");
            log.warn("Groq stream reported an error ({})", SAFE_CODE.matcher(code).matches() ? code : "unknown");
            throw new CoachException(code.contains("rate_limit") ? Kind.RATE_LIMITED : Kind.FAILED, "The tutor provider reported an error.", null);
        }
        JsonNode content = node.path("choices").path(0).path("delta").path("content");
        return content.isTextual() ? content.asText() : null; // delta.reasoning (gpt-oss) is deliberately ignored
    }

    // ------------------------------------------------------------------------------------------------ plumbing

    private void requireConfigured() {
        if (!isConfigured()) throw new CoachException(Kind.UNAVAILABLE, "The AI coach is not configured.", null);
        if (configProblem != null) throw new CoachException(Kind.UNAVAILABLE, "The AI coach is misconfigured: " + configProblem + ".", null);
    }

    private static List<Map<String, String>> messages(String system, List<TutorService.Turn> turns) {
        List<Map<String, String>> all = new java.util.ArrayList<>();
        all.add(Map.of("role", "system", "content", system));
        for (TutorService.Turn t : turns) all.add(Map.of("role", t.role(), "content", t.content()));
        return all;
    }

    private Map<String, Object> completionBody(List<? extends Map<String, String>> messages, double temperature, int maxTokens, boolean stream) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", config.model());
        body.put("messages", messages);
        body.put("temperature", temperature);
        // Reasoning tokens count towards this limit, so it leaves room for a short reasoning pass plus the answer.
        body.put("max_completion_tokens", maxTokens);
        body.put("reasoning_effort", "low"); // faster replies for a conversation; dropped automatically if the model rejects it
        if (stream) body.put("stream", true);
        return body;
    }

    private static Map<String, Object> untuned(Map<String, Object> body) {
        Map<String, Object> copy = new LinkedHashMap<>(body);
        copy.remove("reasoning_effort");
        return copy;
    }

    private HttpRequest request(Map<String, Object> body, String accept) {
        try {
            return HttpRequest.newBuilder(URI.create(baseUrl + "/chat/completions"))
                    .timeout(requestTimeout)
                    .header("Content-Type", "application/json")
                    .header("Accept", accept)
                    .header("Authorization", "Bearer " + apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build();
        } catch (IOException e) {
            throw new CoachException("The request could not be prepared.", e);
        } catch (IllegalArgumentException e) {
            // Safety net: the JDK's message repeats the rejected header value, which would be our API key, so it is neither logged nor chained.
            log.error("The request to the AI provider could not be built (invalid GROQ_API_KEY or GROQ_BASE_URL); the value is not shown.");
            throw new CoachException(Kind.UNAVAILABLE, "The AI coach is misconfigured.", null);
        }
    }

    /** One non-streamed call with a single retry for rate limits, server errors and dropped connections. Returns the response body. */
    private String post(Map<String, Object> body) {
        boolean retried = false;
        boolean untuned = false;
        for (;;) {
            try {
                HttpResponse<String> response = http.send(request(body, "application/json"), HttpResponse.BodyHandlers.ofString());
                int status = response.statusCode();
                if (status / 100 == 2) return response.body();
                String code = errorCode(response.body());
                log.warn("Groq returned HTTP {}{}", status, code == null ? "" : " (" + code + ")");
                if (status == 400 && !untuned && body.containsKey("reasoning_effort")) { body = untuned(body); untuned = true; continue; }
                int wait = retryAfterSeconds(response.headers());
                if (!retried && isTransient(status) && worthRetrying(status, wait)) { retried = true; pause(wait); continue; }
                throw failure(status, code, wait);
            } catch (HttpTimeoutException e) {
                throw new CoachException(Kind.TIMEOUT, "The tutor took too long to answer.", e);
            } catch (IOException e) {
                if (!retried) { retried = true; continue; }
                throw new CoachException("The tutor provider could not be reached.", e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new CoachException("The request was interrupted.", e);
            }
        }
    }

    private CoachException failure(int status, String code, int retryAfter) {
        if (status == 429) return new CoachException(Kind.RATE_LIMITED, "The provider is rate limiting requests.", null).retryAfter(retryAfter);
        if (status == 401 || status == 403) {
            log.error("Groq rejected the API key (HTTP {}). Check GROQ_API_KEY.", status);
            return new CoachException(Kind.UNAVAILABLE, "The provider rejected the credentials.", null);
        }
        if (status == 404 || status == 503 || (status == 400 && code != null && code.startsWith("model_"))) {
            return new CoachException(Kind.UNAVAILABLE, "The model is not available.", null);
        }
        return new CoachException("The tutor provider returned an error.");
    }

    private static boolean isTransient(int status) { return status == 429 || status == 500 || status == 502 || status == 503 || status == 529; }

    /** The provider's Retry-After in whole seconds (rounded up, at most 300), or 0 when absent or unreadable. */
    private static int retryAfterSeconds(java.net.http.HttpHeaders headers) {
        String after = headers.firstValue("retry-after").orElse(null);
        if (after == null) return 0;
        try {
            return (int) Math.min(300, Math.max(0, Math.ceil(Double.parseDouble(after.strip()))));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /**
     * A retry only helps when the wait is short. A rate limit that asks for longer than we are willing to hold the learner is
     * reported straight away (with the wait) instead of being hit again, which would only use up more of the quota.
     */
    private boolean worthRetrying(int status, int retryAfterSeconds) {
        return status != 429 || retryAfterSeconds * 1000L <= maxRetryWait.toMillis();
    }

    /** Waits before the single retry: the provider's Retry-After when it gave one (already known to be short), otherwise half a second. */
    private void pause(int retryAfterSeconds) {
        long millis = retryAfterSeconds > 0 ? retryAfterSeconds * 1000L : 500;
        millis = Math.max(0, Math.min(millis, maxRetryWait.toMillis()));
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CoachException("The request was interrupted.", e);
        }
    }

    /** A short machine code from an error body (for the log and for telling a retired model apart), never the message. */
    private String errorCode(String body) {
        try {
            String code = mapper.readTree(body).path("error").path("code").asText("");
            return SAFE_CODE.matcher(code).matches() ? code : null;
        } catch (Exception e) {
            return null;
        }
    }

    String replyText(String responseBody) throws IOException {
        JsonNode choice = mapper.readTree(responseBody).path("choices").path(0);
        String reply = choice.path("message").path("content").asText("").strip();
        if (reply.isEmpty()) {
            boolean cutOff = "length".equals(choice.path("finish_reason").asText());
            throw new CoachException(cutOff ? "The tutor ran out of room before answering." : "The tutor returned an empty reply.");
        }
        return reply;
    }

    private static String stripSlash(String url) { return url.endsWith("/") ? url.substring(0, url.length() - 1) : url; }
}
