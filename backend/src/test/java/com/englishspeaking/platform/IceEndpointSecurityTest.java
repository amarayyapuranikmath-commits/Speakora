package com.englishspeaking.platform;

import com.englishspeaking.platform.security.JwtService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * GET /api/calls/ice-servers through the real security chain with NO trusted proxy: it must require a valid access token,
 * must ignore a forwarded client IP it was not told to trust, and must never expose the Turnix token. (No database: repositories are mocks.)
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "spring.autoconfigure.exclude="
                        + "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,"
                        + "org.springframework.boot.autoconfigure.jdbc.DataSourceTransactionManagerAutoConfiguration,"
                        + "org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration,"
                        + "org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration,"
                        + "org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration",
                "spring.config.import=",
                "management.endpoint.health.group.readiness.include=readinessState",
                "management.health.redis.enabled=false",
                "app.jwt.secret=" + TestSupport.SECRET,
                "spring.datasource.password=unused",
                "app.turn.api-token=" + IceEndpointTestBase.TOKEN
        })
class IceEndpointSecurityTest extends IceEndpointTestBase {
    @DynamicPropertySource
    static void turnix(DynamicPropertyRegistry r) { r.add("app.turn.api-url", IceEndpointTestBase::turnixUrl); }

    @Autowired TestRestTemplate http;
    @Autowired JwtService jwt;

    @BeforeEach
    void clear() { SEEN.clear(); }

    private ResponseEntity<String> get(HttpHeaders headers) {
        return http.exchange("/api/calls/ice-servers", HttpMethod.GET, new HttpEntity<>(headers), String.class);
    }

    private HttpHeaders bearer(String token) {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(token);
        return h;
    }

    @Test
    void requiresAuthenticationAndNeverCallsTurnixWithout() {
        ResponseEntity<String> anonymous = get(new HttpHeaders());
        assertThat(anonymous.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(anonymous.getBody()).contains("UNAUTHENTICATED").doesNotContain(TOKEN);

        assertThat(get(bearer("not.a.jwt")).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(get(bearer(jwt.createWsTicket(UUID.randomUUID()))).getStatusCode()).as("a WebSocket ticket is not an access token").isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(SEEN).isEmpty();
    }

    @Test
    void anAuthenticatedUserGetsTurnixCredentialsAndTheResponseKeepsItsShape() {
        ResponseEntity<String> r = get(bearer(jwt.createAccessToken(UUID.randomUUID(), "USER")));

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(r.getHeaders().getFirst("Cache-Control")).contains("no-store");
        assertThat(r.getBody()).contains("\"iceServers\"", "\"turnConfigured\":true", "\"ttlSeconds\":3600", "\"forceRelay\":false",
                "\"username\":\"u-1\"", "\"credential\":\"c-1\"");
        var expires = java.util.regex.Pattern.compile("\"expiresAt\":\"([^\"]+)\"").matcher(r.getBody());
        assertThat(expires.find()).isTrue();
        assertThat(java.time.Instant.parse(expires.group(1))).isBetween(java.time.Instant.now().plusSeconds(3500), java.time.Instant.now().plusSeconds(3700));
        assertThat(r.getBody()).doesNotContain(TOKEN).doesNotContain("Bearer");
        assertThat(SEEN).containsExactly("Bearer " + TOKEN + " | -"); // loopback caller: no useful IP, so no X-TURN-CLIENT-IP
    }

    @Test
    void thePreviousPartnersListRequiresSignInAndIsNeverCached() {
        ResponseEntity<String> anonymous = http.exchange("/api/partners", HttpMethod.GET, new HttpEntity<>(new HttpHeaders()), String.class);
        assertThat(anonymous.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        ResponseEntity<String> signedIn = http.exchange("/api/partners", HttpMethod.GET, new HttpEntity<>(bearer(jwt.createAccessToken(UUID.randomUUID(), "USER"))), String.class);
        assertThat(signedIn.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(signedIn.getHeaders().getFirst("Cache-Control")).contains("no-store");
        assertThat(signedIn.getBody()).isEqualTo("[]");
    }

    @Test
    void aForgedForwardedForHeaderIsNotBelievedWithoutATrustedProxy() {
        HttpHeaders h = bearer(jwt.createAccessToken(UUID.randomUUID(), "USER"));
        h.add("X-Forwarded-For", "8.8.8.8");
        h.add("Forwarded", "for=8.8.4.4");
        assertThat(get(h).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(SEEN).containsExactly("Bearer " + TOKEN + " | -");
    }
}
