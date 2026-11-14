package com.englishspeaking.platform.coach;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TutorControllerTest {
    @Test
    void theFailureLocationNamesTheFramesButNeverTheExceptionMessage() {
        var e = new IllegalArgumentException("invalid header value: \"Bearer gsk_SECRETVALUE\"");
        String where = TutorController.whereItFailed(e);
        assertThat(where).contains("TutorControllerTest.theFailureLocationNamesTheFramesButNeverTheExceptionMessage:");
        assertThat(where).doesNotContain("SECRET").doesNotContain("invalid header");
        assertThat(where.split(" < ").length).isLessThanOrEqualTo(5);
    }

    @Test
    void anExceptionWithoutFramesIsReportedAsUnknown() {
        var e = new RuntimeException("x");
        e.setStackTrace(new StackTraceElement[0]);
        assertThat(TutorController.whereItFailed(e)).isEqualTo("unknown");
    }
}
