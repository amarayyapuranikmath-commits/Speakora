package com.englishspeaking.platform.calling;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import static com.englishspeaking.platform.calling.CallStatus.*;
import static org.assertj.core.api.Assertions.assertThat;

class CallStatusTest {
    @Test
    void happyPathIsAllowed() {
        assertThat(MATCH_FOUND.canTransitionTo(CONNECTING)).isTrue();
        assertThat(CONNECTING.canTransitionTo(CONNECTED)).isTrue();
        assertThat(CONNECTED.canTransitionTo(RECONNECTING)).isTrue();
        assertThat(RECONNECTING.canTransitionTo(CONNECTED)).isTrue();
        assertThat(CONNECTED.canTransitionTo(COMPLETED)).isTrue();
    }

    @Test
    void invalidJumpsAreRejected() {
        assertThat(MATCH_FOUND.canTransitionTo(CONNECTED)).isFalse();
        assertThat(MATCH_FOUND.canTransitionTo(COMPLETED)).isFalse();
        assertThat(CONNECTING.canTransitionTo(COMPLETED)).isFalse();
        assertThat(CONNECTED.canTransitionTo(CANCELLED)).isFalse();
        assertThat(CONNECTED.canTransitionTo(MATCH_FOUND)).isFalse();
    }

    @ParameterizedTest
    @EnumSource(value = CallStatus.class, names = {"COMPLETED", "FAILED", "CANCELLED"})
    void terminalStatesAreFinal(CallStatus terminal) {
        assertThat(terminal.isTerminal()).isTrue();
        for (CallStatus next : CallStatus.values()) assertThat(terminal.canTransitionTo(next)).isFalse();
    }

    @ParameterizedTest
    @EnumSource(value = CallStatus.class, names = {"MATCH_FOUND", "CONNECTING", "CONNECTED", "RECONNECTING"})
    void activeStatesAreNotTerminal(CallStatus active) {
        assertThat(active.isTerminal()).isFalse();
        assertThat(CallStatus.activeStatuses()).contains(active);
    }
}
