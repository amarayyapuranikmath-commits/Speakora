package com.englishspeaking.platform.common;

import org.springframework.http.HttpStatus;

/** Business-rule failure that maps to a safe, client-visible HTTP error. */
public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;
    private final int retryAfterSeconds;

    public ApiException(HttpStatus status, String code, String message) { this(status, code, message, 0); }

    /** @param retryAfterSeconds when greater than zero, sent to the client as a Retry-After header */
    public ApiException(HttpStatus status, String code, String message, int retryAfterSeconds) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryAfterSeconds = Math.max(0, retryAfterSeconds);
    }

    public HttpStatus status() { return status; }
    public String code() { return code; }
    public int retryAfterSeconds() { return retryAfterSeconds; }

    public static ApiException badRequest(String code, String message) { return new ApiException(HttpStatus.BAD_REQUEST, code, message); }
    public static ApiException unauthorized(String code, String message) { return new ApiException(HttpStatus.UNAUTHORIZED, code, message); }
    public static ApiException forbidden(String code, String message) { return new ApiException(HttpStatus.FORBIDDEN, code, message); }
    public static ApiException notFound(String code, String message) { return new ApiException(HttpStatus.NOT_FOUND, code, message); }
    public static ApiException conflict(String code, String message) { return new ApiException(HttpStatus.CONFLICT, code, message); }
    public static ApiException tooManyRequests(String message) { return new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", message); }
}
