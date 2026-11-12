package com.englishspeaking.platform.common;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;

class RetryAfterHeaderTest {
    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void aWaitBecomesARetryAfterHeader() {
        var r = handler.handleApi(new ApiException(HttpStatus.TOO_MANY_REQUESTS, "COACH_BUSY", "Busy.", 12));
        assertThat(r.getHeaders().getFirst("Retry-After")).isEqualTo("12");
        assertThat(r.getStatusCode().value()).isEqualTo(429);
    }

    @Test
    void noWaitMeansNoHeader() {
        assertThat(handler.handleApi(ApiException.badRequest("X", "y")).getHeaders().containsKey("Retry-After")).isFalse();
    }
}
