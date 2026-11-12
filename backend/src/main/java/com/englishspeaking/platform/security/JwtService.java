package com.englishspeaking.platform.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;

/** Issues and verifies short-lived access tokens and 30-second WebSocket tickets (HS256). Ticket single-use is enforced by {@link TicketReplayGuard}. */
@Service
public class JwtService {
    private static final String USE = "use";
    private static final String ACCESS = "access";
    private static final String WS_TICKET = "ws";
    private static final Duration WS_TICKET_TTL = Duration.ofSeconds(30);

    private final SecretKey key;
    private final Duration accessTtl;
    private final Clock clock;

    public JwtService(AppProperties props, Clock clock) {
        byte[] secret = props.jwt().secret().getBytes(StandardCharsets.UTF_8);
        if (secret.length < 32) {
            throw new IllegalStateException("app.jwt.secret must be at least 32 bytes");
        }
        this.key = Keys.hmacShaKeyFor(secret);
        this.accessTtl = Duration.ofMinutes(props.jwt().accessTtlMinutes());
        this.clock = clock;
    }

    public String createAccessToken(UUID userId, String role) {
        return build(userId, ACCESS, accessTtl, role);
    }

    public Duration accessTtl() { return accessTtl; }

    public String createWsTicket(UUID userId) {
        return build(userId, WS_TICKET, WS_TICKET_TTL, null);
    }

    public Optional<AuthPrincipal> parseAccessToken(String token) {
        return parse(token, ACCESS).map(c -> new AuthPrincipal(UUID.fromString(c.getSubject()), c.get("role", String.class)));
    }

    public record WsTicket(UUID userId, String ticketId) {}

    public Optional<WsTicket> parseWsTicket(String token) {
        return parse(token, WS_TICKET).map(c -> new WsTicket(UUID.fromString(c.getSubject()), c.getId()));
    }

    private String build(UUID userId, String use, Duration ttl, String role) {
        Instant now = clock.instant();
        var builder = Jwts.builder().id(UUID.randomUUID().toString()).subject(userId.toString()).claim(USE, use)
                .issuedAt(Date.from(now)).expiration(Date.from(now.plus(ttl)));
        if (role != null) builder.claim("role", role);
        return builder.signWith(key).compact();
    }

    private Optional<Claims> parse(String token, String expectedUse) {
        try {
            Claims claims = Jwts.parser().verifyWith(key).clock(() -> Date.from(clock.instant())).build()
                    .parseSignedClaims(token).getPayload();
            if (!expectedUse.equals(claims.get(USE, String.class))) return Optional.empty();
            return Optional.of(claims);
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
