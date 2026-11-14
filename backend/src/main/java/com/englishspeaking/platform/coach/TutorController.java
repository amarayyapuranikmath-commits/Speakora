package com.englishspeaking.platform.coach;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.security.AuthPrincipal;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The AI Coach API. There are no conversation endpoints on purpose: the learner's device keeps the live conversation in memory and sends
 * the recent turns with each message, so nothing about the conversation is stored here. Message text is never logged.
 */
@RestController
@RequestMapping("/api/coach")
public class TutorController {
    private static final Logger log = LoggerFactory.getLogger(TutorController.class);

    private final TutorService tutor;
    private final TutorPreferencesService prefs;
    /** Streaming replies wait on the provider, so each runs on its own lightweight thread. */
    private final ExecutorService streams = Executors.newVirtualThreadPerTaskExecutor();

    public TutorController(TutorService tutor, TutorPreferencesService prefs) {
        this.tutor = tutor;
        this.prefs = prefs;
    }

    @GetMapping("/status")
    public TutorService.Status status(@AuthenticationPrincipal AuthPrincipal me) { return tutor.status(me.userId()); }

    @GetMapping("/modes")
    public List<TutorService.ModeInfo> modes() { return TutorService.modes(); }

    /** One complete reply, for clients that cannot read a stream. */
    @PostMapping("/chat")
    public TutorService.ChatReply chat(@AuthenticationPrincipal AuthPrincipal me, @Valid @RequestBody TutorService.ChatRequest req) {
        return tutor.chat(me.userId(), req);
    }

    /**
     * The reply as server-sent events: {@code delta} (a piece of text), then {@code done} (the whole reply), or {@code error}. The
     * conversation is whatever the request carries; nothing is stored.
     */
    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@AuthenticationPrincipal AuthPrincipal me, @Valid @RequestBody TutorService.ChatRequest req) {
        var user = me.userId();
        SseEmitter emitter = new SseEmitter(150_000L);
        streams.execute(() -> {
            try {
                TutorService.ChatReply reply = tutor.stream(user, req, piece -> {
                    try {
                        emitter.send(SseEmitter.event().name("delta").data(Map.of("text", piece), MediaType.APPLICATION_JSON));
                    } catch (IOException e) {
                        throw new ClientGone(e); // the learner left or interrupted: stop asking the provider for more
                    }
                });
                emitter.send(SseEmitter.event().name("done").data(reply, MediaType.APPLICATION_JSON));
                emitter.complete();
            } catch (ClientGone e) {
                emitter.complete();
            } catch (ApiException e) {
                finishWithError(emitter, e.code(), e.getMessage(), e.retryAfterSeconds());
            } catch (IOException | RuntimeException e) {
                // The class and where it was thrown, never the message (a JDK message can repeat a header value such as the API key) or the content.
                log.warn("Tutor stream failed: {} at {}", e.getClass().getSimpleName(), whereItFailed(e));
                finishWithError(emitter, "COACH_FAILED", "The tutor could not respond right now. Please try again.", 0);
            }
        });
        return emitter;
    }

    // ---- settings (language and voice speed; not conversation)

    @GetMapping("/preferences")
    public TutorPreferencesService.Preferences preferences(@AuthenticationPrincipal AuthPrincipal me) { return prefs.preferences(me.userId()); }

    @PutMapping("/preferences")
    public TutorPreferencesService.Preferences setPreferences(@AuthenticationPrincipal AuthPrincipal me, @Valid @RequestBody TutorPreferencesService.Preferences body) {
        return prefs.setPreferences(me.userId(), body.explanationLanguage());
    }

    @PutMapping("/preferences/speech-speed")
    public TutorPreferencesService.Preferences setSpeechSpeed(@AuthenticationPrincipal AuthPrincipal me, @Valid @RequestBody TutorPreferencesService.SpeedRequest body) {
        return prefs.setSpeechSpeed(me.userId(), body.speechSpeed());
    }

    /** The first few stack frames as class.method:line (application frames first), without any exception message. */
    static String whereItFailed(Throwable e) {
        StringBuilder sb = new StringBuilder();
        int shown = 0;
        for (StackTraceElement f : e.getStackTrace()) {
            if (shown == 5) break;
            if (shown > 0) sb.append(" < ");
            String cls = f.getClassName();
            sb.append(cls.substring(cls.lastIndexOf('.') + 1)).append('.').append(f.getMethodName()).append(':').append(f.getLineNumber());
            shown++;
        }
        return sb.length() == 0 ? "unknown" : sb.toString();
    }

    private static void finishWithError(SseEmitter emitter, String code, String message, int retryAfterSeconds) {
        try {
            Map<String, Object> payload = new java.util.LinkedHashMap<>(Map.of("code", code, "message", message));
            if (retryAfterSeconds > 0) payload.put("retryAfterSeconds", retryAfterSeconds);
            emitter.send(SseEmitter.event().name("error").data(payload, MediaType.APPLICATION_JSON));
        } catch (IOException ignored) {
            // the connection is already gone
        }
        emitter.complete();
    }

    private static final class ClientGone extends RuntimeException {
        ClientGone(Throwable cause) { super(cause); }
    }
}
