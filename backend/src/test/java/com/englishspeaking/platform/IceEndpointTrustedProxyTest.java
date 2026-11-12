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

/** Same stack, but the loopback peer (this test's HTTP client) is configured as the trusted reverse proxy. */
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
                "app.turn.api-token=" + IceEndpointTestBase.TOKEN,
                "app.turn.force-relay=true",
                "app.turn.trusted-proxies=127.0.0.1,::1"
        })
class IceEndpointTrustedProxyTest extends IceEndpointTestBase {
    @DynamicPropertySource
    static void turnix(DynamicPropertyRegistry r) { r.add("app.turn.api-url", IceEndpointTestBase::turnixUrl); }

    @Autowired TestRestTemplate http;
    @Autowired JwtService jwt;

    @BeforeEach
    void clear() { SEEN.clear(); }

    @Test
    void theRealClientIpFromATrustedProxyIsForwardedToTurnixAndForceRelayIsReported() {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(jwt.createAccessToken(UUID.randomUUID(), "USER"));
        h.add("X-Forwarded-For", "9.9.9.9, 203.0.113.77"); // 9.9.9.9 was supplied by the client; the proxy appended the real address
        ResponseEntity<String> r = http.exchange("/api/calls/ice-servers", HttpMethod.GET, new HttpEntity<>(h), String.class);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(r.getBody()).contains("\"forceRelay\":true");
        assertThat(SEEN).containsExactly("Bearer " + TOKEN + " | 203.0.113.77");
    }
}
