package com.englishspeaking.platform.websocket;

import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.calling.CallSession;
import com.englishspeaking.platform.calling.CallStatus;
import com.englishspeaking.platform.calling.EndReason;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.matching.MatchmakingService;
import com.englishspeaking.platform.matching.MatchmakingStore;
import com.englishspeaking.platform.partners.ConnectionRequestService;
import com.englishspeaking.platform.security.RateLimiter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

/**
 * Signalling channel: queue control, call control and relay of WebRTC offers/answers/ICE candidates.
 * Audio never flows through here; it travels peer-to-peer (or via TURN) over WebRTC.
 */
@Component
public class SignalingHandler extends TextWebSocketHandler {
    private static final Logger log = LoggerFactory.getLogger(SignalingHandler.class);
    static final Duration RECONNECT_GRACE = Duration.ofSeconds(20);
    private static final Set<String> SIGNAL_KINDS = Set.of("offer", "answer", "candidate");

    private final SessionRegistry registry;
    private final MatchmakingService matchmaking;
    private final MatchmakingStore store;
    private final CallService calls;
    private final WsEventBroadcaster broadcaster;
    private final ConnectionRequestService connections;
    private final RateLimiter rateLimiter;
    private final TaskScheduler scheduler;
    private final ObjectMapper mapper;
    private final Map<UUID, ScheduledFuture<?>> graceTimers = new ConcurrentHashMap<>();

    public SignalingHandler(SessionRegistry registry, MatchmakingService matchmaking, MatchmakingStore store, CallService calls,
                            WsEventBroadcaster broadcaster, ConnectionRequestService connections, RateLimiter rateLimiter, TaskScheduler scheduler,
                            ObjectMapper mapper) {
        this.registry = registry;
        this.matchmaking = matchmaking;
        this.store = store;
        this.calls = calls;
        this.broadcaster = broadcaster;
        this.connections = connections;
        this.rateLimiter = rateLimiter;
        this.scheduler = scheduler;
        this.mapper = mapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        UUID userId = userId(session);
        registry.register(userId, session);
        store.touchPresence(userId);
        ScheduledFuture<?> timer = graceTimers.remove(userId);
        if (timer != null) timer.cancel(false);
        registry.send(userId, Map.of("type", "connected"));
        resumeActiveCall(userId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        UUID userId = userId(session);
        if (!rateLimiter.tryAcquire("ws:" + userId, 300, Duration.ofSeconds(10))) {
            closeQuietly(session, new CloseStatus(1008, "Too many messages"));
            return;
        }
        try {
            JsonNode msg = mapper.readTree(message.getPayload());
            String type = text(msg, "type");
            if (type == null) throw ApiException.badRequest("MALFORMED_MESSAGE", "Message type is required.");
            dispatch(userId, type, msg);
        } catch (ApiException e) {
            registry.send(userId, Map.of("type", "error", "code", e.code(), "message", e.getMessage()));
        } catch (org.springframework.dao.DataAccessException e) {
            // Redis or PostgreSQL unavailable: tell the client plainly instead of a generic failure.
            log.error("Data store unavailable while handling signalling for user {}", userId, e);
            registry.send(userId, Map.of("type", "error", "code", "SERVICE_UNAVAILABLE", "message", "Matching is temporarily unavailable. Please try again shortly."));
        } catch (Exception e) {
            log.error("Signalling error for user {}", userId, e);
            registry.send(userId, Map.of("type", "error", "code", "INTERNAL_ERROR", "message", "Something went wrong."));
        }
    }

    private void dispatch(UUID userId, String type, JsonNode msg) throws Exception {
        if (!"ping".equals(type)) log.info("signal-in user={} type={} kind={} call={}", shortId(userId), type, text(msg, "kind"), text(msg, "callId"));
        switch (type) {
            case "ping" -> {
                store.touchPresence(userId);
                registry.send(userId, Map.of("type", "pong"));
            }
            case "queue.join" -> {
                store.touchPresence(userId);
                connections.cancelOutgoing(userId); // starting a random search withdraws any "call again" request still waiting
                matchmaking.join(userId, text(msg, "topicSlug"));
                // If a partner was found, match.found is delivered by the event broadcaster after commit.
                if (calls.activeCallOf(userId).isEmpty()) registry.send(userId, Map.of("type", "queue.joined"));
            }
            case "queue.cancel" -> {
                matchmaking.leave(userId);
                registry.send(userId, Map.of("type", "queue.cancelled"));
            }
            case "connect.request" -> connections.request(userId, text(msg, "friendRef"));
            case "connect.cancel" -> connections.cancel(userId, requestId(msg));
            case "connect.accept" -> connections.accept(userId, requestId(msg));
            case "connect.decline" -> connections.decline(userId, requestId(msg));
            case "signal" -> relaySignal(userId, msg);
            case "call.connected" -> calls.reportConnected(callId(msg), userId);
            case "call.reconnecting" -> calls.reportReconnecting(callId(msg), userId);
            case "call.failed" -> calls.end(callId(msg), userId, EndReason.FAILED);
            case "call.end" -> calls.end(callId(msg), userId, EndReason.ENDED);
            case "call.skip" -> {
                calls.end(callId(msg), userId, EndReason.SKIPPED);
                matchmaking.join(userId, text(msg, "topicSlug"));
                if (calls.activeCallOf(userId).isEmpty()) registry.send(userId, Map.of("type", "queue.joined"));
            }
            default -> throw ApiException.badRequest("UNKNOWN_MESSAGE", "Unknown message type.");
        }
    }

    private void relaySignal(UUID userId, JsonNode msg) {
        UUID callId = callId(msg);
        String kind = text(msg, "kind");
        if (kind == null || !SIGNAL_KINDS.contains(kind) || !msg.hasNonNull("payload")) {
            throw ApiException.badRequest("MALFORMED_MESSAGE", "Invalid signal.");
        }
        UUID partner = activePartner(callId, userId);
        if ("offer".equals(kind)) calls.markOfferRelayed(callId);
        log.info("signal-relay call={} {} {} -> {}", callId, kind, shortId(userId), shortId(partner));
        boolean delivered = registry.send(partner, Map.of("type", "signal", "callId", callId, "kind", kind, "payload", msg.get("payload")));
        if (!delivered) log.debug("Partner {} not connected; dropped {} for call {}", partner, kind, callId);
    }

    /** Resolves the partner and verifies the sender belongs to a call that is still live. */
    private UUID activePartner(UUID callId, UUID userId) {
        Optional<UUID> cached = registry.cachedPartner(callId, userId);
        if (cached.isPresent()) return cached.get();
        CallSession call = calls.getForParticipant(callId, userId);
        if (call.getStatus().isTerminal()) throw ApiException.conflict("CALL_ENDED", "This call has ended.");
        UUID partner = calls.partnerOf(callId, userId);
        registry.rememberPair(callId, userId, partner);
        return partner;
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        UUID userId = userId(session);
        log.info("ws-closed user={} code={} reason={}", shortId(userId), status.getCode(), status.getReason());
        if (!registry.unregister(userId, session)) return; // superseded by a newer connection
        store.clearPresence(userId);
        matchmaking.leave(userId);
        connections.onDisconnect(userId);
        try {
            calls.activeCallOf(userId).ifPresent(call -> {
                calls.reportReconnecting(call.getId(), userId);
                ScheduledFuture<?> timer = scheduler.schedule(() -> endIfStillGone(call.getId(), userId), Instant.now().plus(RECONNECT_GRACE));
                ScheduledFuture<?> previous = graceTimers.put(userId, timer);
                if (previous != null) previous.cancel(false);
            });
        } catch (RuntimeException e) {
            log.error("Disconnect handling failed for {}", userId, e);
        }
    }

    private void endIfStillGone(UUID callId, UUID userId) {
        graceTimers.remove(userId);
        if (registry.isConnected(userId)) return;
        try {
            calls.end(callId, userId, EndReason.DISCONNECTED);
        } catch (RuntimeException e) {
            log.warn("Could not end call {} after disconnect: {}", callId, e.getMessage());
        }
    }

    private void resumeActiveCall(UUID userId) {
        try {
            calls.activeCallOf(userId).ifPresent(call -> broadcaster.sendResume(call, userId));
        } catch (RuntimeException e) {
            log.warn("Could not resume call state for {}: {}", userId, e.getMessage());
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.debug("WebSocket transport error for {}: {}", userId(session), exception.getMessage());
    }

    private static String shortId(UUID id) { return id == null ? "-" : id.toString().substring(0, 8); }

    private static UUID userId(WebSocketSession session) { return (UUID) session.getAttributes().get(WebSocketConfig.USER_ID); }

    private static String text(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    private static UUID requestId(JsonNode msg) {
        try {
            return UUID.fromString(text(msg, "requestId"));
        } catch (RuntimeException e) {
            throw ApiException.badRequest("MALFORMED_MESSAGE", "A valid requestId is required.");
        }
    }

    private static UUID callId(JsonNode msg) {
        try {
            return UUID.fromString(text(msg, "callId"));
        } catch (RuntimeException e) {
            throw ApiException.badRequest("MALFORMED_MESSAGE", "A valid callId is required.");
        }
    }

    private static void closeQuietly(WebSocketSession session, CloseStatus status) {
        try {
            session.close(status);
        } catch (Exception ignored) {
            // already closed
        }
    }
}
