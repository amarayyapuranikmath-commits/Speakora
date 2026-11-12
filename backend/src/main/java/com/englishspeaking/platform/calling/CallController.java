package com.englishspeaking.platform.calling;

import com.englishspeaking.platform.common.PageResponse;
import com.englishspeaking.platform.feedback.FeedbackService;
import com.englishspeaking.platform.security.AuthPrincipal;
import com.englishspeaking.platform.security.ClientIpResolver;
import com.englishspeaking.platform.security.JwtService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class CallController {
    private final CallService calls;
    private final CallHistoryService history;
    private final IceServerService iceServers;
    private final FeedbackService feedback;
    private final JwtService jwt;
    private final ClientIpResolver clientIps;

    public CallController(CallService calls, CallHistoryService history, IceServerService iceServers, FeedbackService feedback, JwtService jwt,
                          ClientIpResolver clientIps) {
        this.calls = calls;
        this.history = history;
        this.iceServers = iceServers;
        this.feedback = feedback;
        this.jwt = jwt;
        this.clientIps = clientIps;
    }

    @GetMapping("/calls")
    public PageResponse<CallHistoryService.CallSummary> list(@AuthenticationPrincipal AuthPrincipal me,
                                                             @RequestParam(defaultValue = "0") int page,
                                                             @RequestParam(defaultValue = "20") int size) {
        return history.history(me.userId(), page, size);
    }

    @GetMapping("/calls/{callId}")
    public CallHistoryService.CallSummary detail(@AuthenticationPrincipal AuthPrincipal me, @PathVariable UUID callId) {
        return history.detail(me.userId(), callId, calls.getForParticipant(callId, me.userId()));
    }

    @GetMapping("/calls/ice-servers")
    public ResponseEntity<IceServerService.IceConfig> ice(@AuthenticationPrincipal AuthPrincipal me, HttpServletRequest request) {
        // Credentials are per request and short-lived: never let a browser or proxy cache them.
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(iceServers.forClient(clientIps.publicIp(request).orElse(null)));
    }

    @PostMapping("/calls/{callId}/feedback")
    public ResponseEntity<Void> feedback(@AuthenticationPrincipal AuthPrincipal me, @PathVariable UUID callId,
                                         @Valid @RequestBody FeedbackService.FeedbackRequest req) {
        feedback.submit(callId, me.userId(), req);
        return ResponseEntity.status(201).build();
    }

    /** Exchanges the caller's access token for a 30-second, WebSocket-only ticket (so the access token never appears in a URL). */
    @PostMapping("/ws/ticket")
    public Map<String, String> wsTicket(@AuthenticationPrincipal AuthPrincipal me) {
        return Map.of("ticket", jwt.createWsTicket(me.userId()));
    }
}
