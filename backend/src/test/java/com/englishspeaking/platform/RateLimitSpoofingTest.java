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
 * Regression test for a rate-limit bypass: the limiter keyed on {@code getRemoteAddr()}, and Spring's forwarded-header handling
 * let a client choose that value with a header, so every request could claim to be a new address and never hit the limit.
 *
 * <p>Runs through the real filter chain with NO trusted proxy configured. Redis points at a dead port so the limiter uses its
 * in-memory fallback (and never touches a developer's Redis).
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
                "app.turn.api-token=unused"
        })
class RateLimitSpoofingTest extends IceEndpointTestBase {
    @DynamicPropertySource
    static void turnix(DynamicPropertyRegistry r) { r.add("app.turn.api-url", IceEndpointTestBase::turnixUrl); }

    @Autowired TestRestTemplate http;

    private HttpStatus login(HttpHeaders extra) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.addAll(extra);
        return HttpStatus.valueOf(http.postForEntity("/api/auth/login", new HttpEntity<>("{\"email\":\"nobody@example.com\",\"password\":\"wrong-password\"}", h), String.class)
                .getStatusCode().value());
    }

    @Test
    void anHonestCallerIsLimitedAfterTenLoginAttempts() {
        HttpStatus last = null;
        for (int i = 0; i < 12; i++) last = login(new HttpHeaders());
        assertThat(last).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    @Test
    void aForgedXForwardedForCannotMakeEveryAttemptLookLikeANewAddress() {
        boolean limited = false;
        for (int i = 0; i < 14 && !limited; i++) {
            HttpHeaders forged = new HttpHeaders();
            forged.add("X-Forwarded-For", "203.0.113." + (i + 1)); // a different "client" every time
            limited = login(forged) == HttpStatus.TOO_MANY_REQUESTS;
        }
        assertThat(limited).as("the 11th attempt from the same real connection must be refused whatever X-Forwarded-For says").isTrue();
    }

    @Test
    void aForgedForwardedHeaderCannotBypassTheLimitEither() {
        boolean limited = false;
        for (int i = 0; i < 14 && !limited; i++) {
            HttpHeaders forged = new HttpHeaders();
            forged.add("Forwarded", "for=198.51.100." + (i + 1) + ";proto=https;host=evil.example");
            limited = login(forged) == HttpStatus.TOO_MANY_REQUESTS;
        }
        assertThat(limited).isTrue();
    }
}
