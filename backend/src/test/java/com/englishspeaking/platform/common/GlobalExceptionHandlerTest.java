package com.englishspeaking.platform.common;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalExceptionHandlerTest {
    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void unknownPathIs404NotAServerError() {
        ResponseEntity<ApiError> res = handler.handleUnexpected(new NoResourceFoundException(HttpMethod.GET, "/api/nope"));
        assertThat(res.getStatusCode().value()).isEqualTo(404);
        assertThat(res.getBody().code()).isEqualTo("NOT_FOUND");
    }

    @Test
    void wrongMethodIs405() {
        ResponseEntity<ApiError> res = handler.handleUnexpected(new HttpRequestMethodNotSupportedException("PATCH"));
        assertThat(res.getStatusCode().value()).isEqualTo(405);
    }

    @Test
    void trulyUnexpectedErrorsAre500WithoutDetails() {
        ResponseEntity<ApiError> res = handler.handleUnexpected(new IllegalStateException("password=hunter2"));
        assertThat(res.getStatusCode().value()).isEqualTo(500);
        assertThat(res.getBody().message()).doesNotContain("hunter2");
    }
}
