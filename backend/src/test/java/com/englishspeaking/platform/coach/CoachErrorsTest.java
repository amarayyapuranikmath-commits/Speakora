package com.englishspeaking.platform.coach;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;

class CoachErrorsTest {
    private static com.englishspeaking.platform.common.ApiException map(CoachProvider.Kind kind, String what) {
        return CoachErrors.toApi(new CoachProvider.CoachException(kind, "provider detail that must never reach the learner", null), what);
    }

    @Test
    void eachProviderProblemBecomesADistinctLearnerFriendlyError() {
        var busy = map(CoachProvider.Kind.RATE_LIMITED, "tutor");
        assertThat(busy.status()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(busy.code()).isEqualTo("COACH_BUSY");
        var slow = map(CoachProvider.Kind.TIMEOUT, "tutor");
        assertThat(slow.status()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);
        assertThat(slow.code()).isEqualTo("COACH_TIMEOUT");
        var gone = map(CoachProvider.Kind.UNAVAILABLE, "tutor");
        assertThat(gone.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(gone.code()).isEqualTo("COACH_UNAVAILABLE");
        var failed = map(CoachProvider.Kind.FAILED, "coach");
        assertThat(failed.status()).isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(failed.code()).isEqualTo("COACH_FAILED");
        assertThat(failed.getMessage()).isEqualTo("The coach could not respond right now. Please try again.");
    }

    @Test
    void theProvidersWaitIsPassedOn() {
        var busy = CoachErrors.toApi(new CoachProvider.CoachException(CoachProvider.Kind.RATE_LIMITED, "x", null).retryAfter(17), "tutor");
        assertThat(busy.retryAfterSeconds()).isEqualTo(17);
        assertThat(map(CoachProvider.Kind.TIMEOUT, "tutor").retryAfterSeconds()).isZero();
    }

    @Test
    void providerDetailsNeverReachTheLearner() {
        for (CoachProvider.Kind k : CoachProvider.Kind.values()) {
            assertThat(map(k, "tutor").getMessage()).doesNotContain("provider detail").doesNotContainIgnoringCase("groq");
        }
    }
}
