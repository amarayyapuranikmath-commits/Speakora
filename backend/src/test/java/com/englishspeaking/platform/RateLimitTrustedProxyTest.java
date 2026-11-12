package com.englishspeaking.platform;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Behind a reverse proxy (here the loopback test client is the configured trusted proxy) every real visitor must get their own
 * limit, and a visitor must not be able to dodge it by adding fake addresses in front of the one the proxy appended.
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
                "spring.data.redis.port=1",
                "spring.data.redis.timeout=100ms",
                "spring.data.redis.connect-timeout=100ms",
                "app.turn.api-token=unused",
                "app.turn.trusted-proxies=127.0.0.1,::1"
        })
class RateLimitTrustedProxyTest extends IceEndpointTestBase {
    @DynamicPropertySource
    static void turnix(DynamicPropertyRegistry r) { r.add("app.turn.api-url", IceEndpointTestBase::turnixUrl); }

    @Autowired TestRestTemplate http;

    private HttpStatus login(String xForwardedFor) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.add("X-Forwarded-For", xForwardedFor);
        return HttpStatus.valueOf(http.postForEntity("/api/auth/login", new HttpEntity<>("{\"email\":\"nobody@example.com\",\"password\":\"wrong-password\"}", h), String.class)
                .getStatusCode().value());
    }

    @Test
    void eachRealVisitorBehindTheProxyHasTheirOwnLimit() {
        for (int i = 0; i < 10; i++) assertThat(login("203.0.113.10")).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(login("203.0.113.10")).as("visitor A used up their ten attempts").isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(login("203.0.113.11")).as("visitor B is unaffected by A").isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void fakeAddressesPrependedByTheVisitorDoNotCreateNewBuckets() {
        boolean limited = false;
        for (int i = 0; i < 14 && !limited; i++) {
            // The visitor supplies "9.9.9.n"; the trusted proxy appends the address it really saw (198.51.100.77).
            limited = login("9.9.9." + (i + 1) + ", 198.51.100.77") == HttpStatus.TOO_MANY_REQUESTS;
        }
        assertThat(limited).isTrue();
    }
}
