package com.englishspeaking.platform.security;

import com.englishspeaking.platform.common.RequestIdFilter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.slf4j.MDC;

import static org.assertj.core.api.Assertions.assertThat;

class ProductionSafetyCheckTest {
    private static final String STRONG = "a".repeat(64);

    private AppProperties props(String baseUrl, String cors, boolean secure, String jwt, String turnToken, String turnUrl) {
        return new AppProperties("n", baseUrl, cors, new AppProperties.Jwt(jwt, 15), 30, secure, new AppProperties.Turn(turnToken, turnUrl, false, ""));
    }

    @Test
    void aProperProductionConfigurationHasNoProblems() {
        assertThat(ProductionSafetyCheck.problems(props("https://speak.example.com", "https://speak.example.com", true, STRONG, "tx-token-value", "https://turnix.io/api/v1/credentials/ice"))).isEmpty();
    }

    @Test
    void everyInsecureSettingIsReportedAtOnce() {
        var problems = ProductionSafetyCheck.problems(props("http://localhost:5173", "http://localhost:5173,https://ok.example.com", false, "change-me-change-me", "", "http://turnix.local/x"));
        assertThat(problems).anyMatch(p -> p.contains("COOKIE_SECURE"))
                .anyMatch(p -> p.contains("APP_BASE_URL"))
                .anyMatch(p -> p.contains("CORS") && p.contains("http://localhost:5173"))
                .anyMatch(p -> p.contains("JWT_SECRET"))
                .anyMatch(p -> p.contains("TURNIX_API_TOKEN"))
                .anyMatch(p -> p.contains("TURNIX_API_URL"));
    }

    @Test
    void theApplicationRefusesToStartWhenUnsafe() {
        var check = new ProductionSafetyCheck(props("http://x", "http://x", false, "short", "", ""), "no-reply@speak.example", "re_x", "");
        org.assertj.core.api.Assertions.assertThatThrownBy(check::verify).isInstanceOf(IllegalStateException.class).hasMessageContaining("COOKIE_SECURE");
    }

    @Test
    void aPlaceholderMailSenderStopsAProductionStart() {
        var safe = props("https://x", "https://x", true, "a-very-long-random-secret-value-that-is-more-than-48-chars", "turnix-token", "https://turnix.io/api/v1/credentials/ice");
        for (String bad : new String[] {"", "no-reply@example.com", "Speak <hello@example.org>"}) {
            org.assertj.core.api.Assertions.assertThatThrownBy(new ProductionSafetyCheck(safe, bad, "re_x", "")::verify)
                    .isInstanceOf(IllegalStateException.class).hasMessageContaining("MAIL_FROM");
        }
        org.assertj.core.api.Assertions.assertThatCode(new ProductionSafetyCheck(safe, "no-reply@speak.example", "", "smtp.example.net")::verify).doesNotThrowAnyException();
    }

    @Test
    void resendAloneIsAValidProductionMailSetup() {
        var safe = props("https://x", "https://x", true, "a-very-long-random-secret-value-that-is-more-than-48-chars", "turnix-token", "https://turnix.io/api/v1/credentials/ice");
        org.assertj.core.api.Assertions.assertThatCode(new ProductionSafetyCheck(safe, "onboarding@resend.dev", "re_abc123", "")::verify).doesNotThrowAnyException();
    }

    @Test
    void noMailProviderStopsAProductionStartAndTheMessageNamesTheSettingNotAKey() {
        var safe = props("https://x", "https://x", true, "a-very-long-random-secret-value-that-is-more-than-48-chars", "turnix-token", "https://turnix.io/api/v1/credentials/ice");
        org.assertj.core.api.Assertions.assertThatThrownBy(new ProductionSafetyCheck(safe, "no-reply@speak.example", "  ", "")::verify)
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("RESEND_API_KEY");
    }

    @Test
    void secretsNeverAppearWhenTheConfigurationIsPrintedOrLogged() {
        var p = new AppProperties("n", "https://x", "https://x", new AppProperties.Jwt("super-secret-jwt-key-super-secret-jwt-key", 15), 30, true,
                new AppProperties.Turn("turnix-token-value-123", "https://turnix.io/api/v1/credentials/ice", false, ""), "admin@example.com", new AppProperties.Coach("gsk_REAL-LOOKING-KEY", "m", "https://api.groq.com/openai/v1", 20));
        String printed = p.toString() + p.coach() + p.jwt() + p.turn();
        assertThat(printed).doesNotContain("super-secret-jwt").doesNotContain("turnix-token-value-123").doesNotContain("sk-ant-REAL");
        assertThat(printed).contains("apiKey=***");
        assertThat(new AppProperties.Coach("", "m", "u", 1).toString()).contains("<unset>");
    }

    @Test
    void requestIdsAreGeneratedEchoedAndClearedFromTheLogContext() throws Exception {
        var filter = new RequestIdFilter();
        var req = new MockHttpServletRequest();
        var res = new MockHttpServletResponse();
        filter.doFilter(req, res, new MockFilterChain());
        assertThat(res.getHeader("X-Request-Id")).hasSize(36);
        assertThat(MDC.get("requestId")).isNull();

        var req2 = new MockHttpServletRequest();
        req2.addHeader("X-Request-Id", "trace-abc12345");
        var res2 = new MockHttpServletResponse();
        filter.doFilter(req2, res2, new MockFilterChain());
        assertThat(res2.getHeader("X-Request-Id")).isEqualTo("trace-abc12345");

        var req3 = new MockHttpServletRequest(); // an attacker-controlled value with a newline must never reach the logs
        req3.addHeader("X-Request-Id", "bad\nvalue-forged");
        var res3 = new MockHttpServletResponse();
        filter.doFilter(req3, res3, new MockFilterChain());
        assertThat(res3.getHeader("X-Request-Id")).isNotEqualTo("bad\nvalue-forged").hasSize(36);
    }
}
