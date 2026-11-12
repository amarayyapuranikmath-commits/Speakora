package com.englishspeaking.platform.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/** Tracks one live signalling socket per user, plus a small cache of who is paired in which call. */
@Component
public class SessionRegistry {
    private static final Logger log = LoggerFactory.getLogger(SessionRegistry.class);

    private record Pair(UUID a, UUID b) {
        Optional<UUID> other(UUID me) { return me.equals(a) ? Optional.of(b) : me.equals(b) ? Optional.of(a) : Optional.empty(); }
    }

    private final ConcurrentMap<UUID, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final ConcurrentMap<UUID, Pair> pairs = new ConcurrentHashMap<>();
    private final ObjectMapper mapper;

    public SessionRegistry(ObjectMapper mapper) { this.mapper = mapper; }

    /** Registers the socket; a user has a single connection, so any older one is closed. */
    public void register(UUID userId, WebSocketSession session) {
        WebSocketSession old = sessions.put(userId, session);
        if (old != null && old != session && old.isOpen()) {
            try {
                old.close(new CloseStatus(4001, "Opened in another tab"));
            } catch (IOException e) {
                log.debug("Closing replaced socket failed: {}", e.getMessage());
            }
        }
    }

    /** @return true if {@code session} was the current one (false if it had already been replaced). */
    public boolean unregister(UUID userId, WebSocketSession session) { return sessions.remove(userId, session); }

    /** Closes the user's socket (suspension / deletion). */
    public void closeUser(UUID userId, String reason) {
        WebSocketSession s = sessions.get(userId);
        if (s != null && s.isOpen()) {
            try {
                s.close(new CloseStatus(4003, reason));
            } catch (IOException e) {
                log.debug("Closing socket for {} failed: {}", userId, e.getMessage());
            }
        }
    }

    public boolean isConnected(UUID userId) {
        WebSocketSession s = sessions.get(userId);
        return s != null && s.isOpen();
    }

    public boolean send(UUID userId, Object message) {
        WebSocketSession session = sessions.get(userId);
        if (session == null || !session.isOpen()) return false;
        try {
            TextMessage text = new TextMessage(mapper.writeValueAsString(message));
            synchronized (session) { // WebSocketSession.sendMessage is not safe for concurrent use
                session.sendMessage(text);
            }
            return true;
        } catch (IOException | RuntimeException e) {
            log.warn("Failed to send websocket message to {}: {}", userId, e.getMessage());
            return false;
        }
    }

    public void rememberPair(UUID callId, UUID a, UUID b) { pairs.put(callId, new Pair(a, b)); }

    public Optional<UUID> cachedPartner(UUID callId, UUID me) {
        Pair p = pairs.get(callId);
        return p == null ? Optional.empty() : p.other(me);
    }

    public void forgetPair(UUID callId) { pairs.remove(callId); }
}
