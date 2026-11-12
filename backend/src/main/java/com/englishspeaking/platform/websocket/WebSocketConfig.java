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

    public WebSocketConfig(SignalingHandler handler, JwtService jwt, AppProperties props, TicketReplayGuard replayGuard, RevokedSessions revoked) {
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
                .setAllowedOrigins(props.corsOrigins().toArray(String[]::new));
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
