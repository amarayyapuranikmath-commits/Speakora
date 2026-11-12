package com.englishspeaking.platform.common;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record ApiError(String code, String message, Map<String, String> details, Instant timestamp) {
    public static ApiError of(String code, String message) { return new ApiError(code, message, Map.of(), Instant.now()); }
    public static ApiError of(String code, String message, Map<String, String> details) { return new ApiError(code, message, details, Instant.now()); }
}
