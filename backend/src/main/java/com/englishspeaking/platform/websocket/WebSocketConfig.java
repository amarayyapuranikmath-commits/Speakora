package com.englishspeaking.platform.websocket;

import com.englishspeaking.platform.security.AppProperties;
import com.englishspeaking.platform.security.JwtService;
import com.englishspeaking.platform.security.RevokedSessions;
import com.englishspeaking.platform.security.TicketReplayGuard;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

import java.util.Map;
import java.util.UUID;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    static final String USER_ID = "userId";

    private final SignalingHandler handler;
    private final JwtService jwt;
    private final AppProperties props;
    private final TicketReplayGuard replayGuard;
    private final RevokedSessions revoked;
    private final String publicWsUrl;
    private final String renderExternalUrl;

    public WebSocketConfig(SignalingHandler handler, JwtService jwt, AppProperties props, TicketReplayGuard replayGuard, RevokedSessions revoked,
                           @org.springframework.beans.factory.annotation.Value("${PUBLIC_WS_URL:}") String publicWsUrl,
                           @org.springframework.beans.factory.annotation.Value("${RENDER_EXTERNAL_URL:}") String renderExternalUrl) {
        this.publicWsUrl = publicWsUrl;
        this.renderExternalUrl = renderExternalUrl;
        this.handler = handler;
        this.jwt = jwt;
        this.props = props;
        this.replayGuard = replayGuard;
        this.revoked = revoked;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws/signaling")
                .addInterceptors(ticketInterceptor())
                .setAllowedOrigins(allowedOrigins(props.corsOrigins(), publicWsUrl, renderExternalUrl).toArray(String[]::new));
    }

    /**
     * The website origins, plus this server's own public https origin. The Android app is not a website: it sends the server's own address as its
     * Origin. Behind a TLS-terminating proxy (Render) the server sees plain http, so Spring's "same origin" check fails for that https Origin and
     * the app was refused with 403; naming the server's own public origin fixes that without admitting any other site.
     */
    static java.util.List<String> allowedOrigins(java.util.List<String> cors, String publicWsUrl, String renderExternalUrl) {
        java.util.LinkedHashSet<String> all = new java.util.LinkedHashSet<>(cors);
        String own = ownOrigin(publicWsUrl, renderExternalUrl);
        if (own != null) all.add(own);
        return java.util.List.copyOf(all);
    }

    /** https://host (no path) of this server, from PUBLIC_WS_URL (wss://host/ws/signaling) or RENDER_EXTERNAL_URL, or null when unknown. */
    static String ownOrigin(String publicWsUrl, String renderExternalUrl) {
        String ws = publicWsUrl == null ? "" : publicWsUrl.strip();
        java.net.URI uri = null;
        try {
            if (ws.regionMatches(true, 0, "wss://", 0, 6)) uri = new java.net.URI("https://" + ws.substring(6));
            else if (ws.regionMatches(true, 0, "ws://", 0, 5)) uri = new java.net.URI("http://" + ws.substring(5));
            else if (renderExternalUrl != null && renderExternalUrl.strip().regionMatches(true, 0, "https://", 0, 8)) uri = new java.net.URI(renderExternalUrl.strip());
        } catch (java.net.URISyntaxException e) {
            return null;
        }
        if (uri == null || uri.getHost() == null) return null;
        return uri.getScheme().toLowerCase(java.util.Locale.ROOT) + "://" + uri.getHost().toLowerCase(java.util.Locale.ROOT) + (uri.getPort() > 0 ? ":" + uri.getPort() : "");
    }

    /** Authenticates the handshake with the short-lived ticket from POST /api/ws/ticket. */
    private HandshakeInterceptor ticketInterceptor() {
        return new HandshakeInterceptor() {
            @Override
            public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler wsHandler,
                                           Map<String, Object> attributes) {
                if (!(request instanceof ServletServerHttpRequest servletRequest)) return false;
                String ticket = servletRequest.getServletRequest().getParameter("ticket");
                if (ticket == null) return false;
                return jwt.parseWsTicket(ticket)
                        .filter(t -> !revoked.isBlocked(t.userId()))
                        .filter(t -> replayGuard.consume(t.ticketId())) // single use
                        .map(t -> {
                            attributes.put(USER_ID, t.userId());
                            return true;
                        }).orElse(false);
            }

            @Override
            public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler wsHandler, Exception ex) {}
        };
    }

    @Bean
    ServletServerContainerFactoryBean webSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(64 * 1024);
        container.setMaxSessionIdleTimeout(5 * 60 * 1000L);
        return container;
    }
}
