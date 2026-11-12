package com.englishspeaking.platform.security;

import com.englishspeaking.platform.TestSupport;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtServiceTest {
    private final TestSupport.MutableClock clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z"));
    private final JwtService jwt = new JwtService(TestSupport.props(), clock);
    private final UUID user = UUID.randomUUID();

    @Test
    void accessTokenRoundTrips() {
        var principal = jwt.parseAccessToken(jwt.createAccessToken(user, "USER"));
        assertThat(principal).isPresent();
        assertThat(principal.get().userId()).isEqualTo(user);
        assertThat(principal.get().role()).isEqualTo("USER");
    }

    @Test
    void expiredAccessTokenIsRejected() {
        String token = jwt.createAccessToken(user, "USER");
        clock.advance(Duration.ofMinutes(16));
        assertThat(jwt.parseAccessToken(token)).isEmpty();
    }

    @Test
    void wsTicketCannotBeUsedAsAccessTokenAndViceVersa() {
        assertThat(jwt.parseAccessToken(jwt.createWsTicket(user))).isEmpty();
        assertThat(jwt.parseWsTicket(jwt.createAccessToken(user, "USER"))).isEmpty();
        assertThat(jwt.parseWsTicket(jwt.createWsTicket(user))).map(JwtService.WsTicket::userId).contains(user);
    }

    @Test
    void wsTicketExpiresQuickly() {
        String ticket = jwt.createWsTicket(user);
        clock.advance(Duration.ofSeconds(31));
        assertThat(jwt.parseWsTicket(ticket)).isEmpty();
    }

    @Test
    void tamperedAndGarbageTokensAreRejected() {
        String token = jwt.createAccessToken(user, "USER");
        assertThat(jwt.parseAccessToken(token.substring(0, token.length() - 3) + "abc")).isEmpty();
        assertThat(jwt.parseAccessToken("not-a-jwt")).isEmpty();
        assertThat(jwt.parseAccessToken("")).isEmpty();
    }

    @Test
    void tokenSignedWithAnotherSecretIsRejected() {
        var otherProps = new AppProperties("x", "x", "x", new AppProperties.Jwt("another-secret-another-secret-another-99", 15), 30, false,
                new AppProperties.Turn());
        String foreign = new JwtService(otherProps, clock).createAccessToken(user, "USER");
        assertThat(jwt.parseAccessToken(foreign)).isEmpty();
    }

    @Test
    void shortSecretFailsFast() {
        var weak = new AppProperties("x", "x", "x", new AppProperties.Jwt("short", 15), 30, false, new AppProperties.Turn());
        assertThatThrownBy(() -> new JwtService(weak, clock)).isInstanceOf(IllegalStateException.class);
    }
}
