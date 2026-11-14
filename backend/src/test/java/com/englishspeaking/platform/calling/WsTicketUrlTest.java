package com.englishspeaking.platform.calling;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class WsTicketUrlTest {
    @Test
    void rendersOwnPublicAddressBecomesItsSignalingSocket() {
        assertThat(CallController.signalingUrl("", "https://speakora-6mkd.onrender.com")).isEqualTo("wss://speakora-6mkd.onrender.com/ws/signaling");
        assertThat(CallController.signalingUrl(null, "https://speakora-6mkd.onrender.com/")).isEqualTo("wss://speakora-6mkd.onrender.com/ws/signaling");
    }

    @Test
    void anExplicitPublicWsUrlWinsOverRendersAddress() {
        assertThat(CallController.signalingUrl("wss://api.speak.example/ws/signaling", "https://speakora-6mkd.onrender.com")).isEqualTo("wss://api.speak.example/ws/signaling");
    }

    @Test
    void whenTheServerDoesNotKnowItsAddressNothingIsClaimed() {
        assertThat(CallController.signalingUrl("", "")).isNull();
        assertThat(CallController.signalingUrl(null, null)).isNull();
        assertThat(CallController.signalingUrl("https://not-a-websocket.example", "http://insecure.example")).isNull();
    }
}
