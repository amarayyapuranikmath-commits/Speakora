package com.englishspeaking.platform.coach;

import com.englishspeaking.platform.common.ApiException;
import org.springframework.http.HttpStatus;

/** Turns a provider failure into the error the learner sees. Provider messages and bodies never reach the client. */
final class CoachErrors {
    private CoachErrors() {}

    static ApiException toApi(CoachProvider.CoachException e, String what) {
        return switch (e.kind()) {
            case RATE_LIMITED -> new ApiException(HttpStatus.TOO_MANY_REQUESTS, "COACH_BUSY", "The " + what + " is very busy right now. Please try again in a moment.", e.retryAfterSeconds());
            case TIMEOUT -> new ApiException(HttpStatus.GATEWAY_TIMEOUT, "COACH_TIMEOUT", "The " + what + " took too long to answer. Please try again.");
            case UNAVAILABLE -> new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "COACH_UNAVAILABLE", "The AI " + what + " is not available right now. Please try again later.");
            case FAILED -> new ApiException(HttpStatus.BAD_GATEWAY, "COACH_FAILED", "The " + what + " could not respond right now. Please try again.");
        };
    }
}
