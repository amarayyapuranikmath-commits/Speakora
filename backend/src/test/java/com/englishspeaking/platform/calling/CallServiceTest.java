package com.englishspeaking.platform.calling;

import com.englishspeaking.platform.TestSupport;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.statistics.StatisticsService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CallServiceTest {
    @Mock CallSessionRepository sessions;
    @Mock CallParticipantRepository participants;
    @Mock StatisticsService statistics;
    @Mock ApplicationEventPublisher events;

    final TestSupport.MutableClock clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z"));
    final UUID callId = UUID.randomUUID();
    final UUID alice = UUID.randomUUID();
    final UUID bob = UUID.randomUUID();
    CallService service;
    CallSession session;

    @BeforeEach
    void setUp() {
        service = new CallService(sessions, participants, statistics, events, clock);
        session = new CallSession(callId, null, clock.instant());
        when(sessions.findByIdForUpdate(callId)).thenReturn(Optional.of(session));
        when(sessions.findById(callId)).thenReturn(Optional.of(session));
        when(participants.findByCallId(callId)).thenReturn(List.of(new CallParticipant(callId, alice), new CallParticipant(callId, bob)));
    }

    private CallEvents.StateChanged lastState() {
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(events, atLeastOnce()).publishEvent(captor.capture());
        return (CallEvents.StateChanged) captor.getAllValues().get(captor.getAllValues().size() - 1);
    }

    @Test
    void callBecomesConnectedOnlyAfterBothPeersReport() {
        service.reportConnected(callId, alice);
        assertThat(session.getStatus()).isEqualTo(CallStatus.MATCH_FOUND);

        service.reportConnected(callId, bob);
        assertThat(session.getStatus()).isEqualTo(CallStatus.CONNECTED);
        assertThat(session.getConnectedAt()).isEqualTo(clock.instant());
    }

    @Test
    void completedCallRecordsDurationAndStatisticsForBothParticipants() {
        service.reportConnected(callId, alice);
        service.reportConnected(callId, bob);
        clock.advance(Duration.ofSeconds(125));

        CallSession ended = service.end(callId, alice, EndReason.ENDED);

        assertThat(ended.getStatus()).isEqualTo(CallStatus.COMPLETED);
        assertThat(ended.getDurationSeconds()).isEqualTo(125);
        verify(statistics).recordCompletedCall(alice, 125, clock.instant());
        verify(statistics).recordCompletedCall(bob, 125, clock.instant());
        assertThat(lastState().endedBy()).isEqualTo(alice);
    }

    @Test
    void endingBeforeConnectionCancelsWithoutStatistics() {
        CallSession ended = service.end(callId, alice, EndReason.SKIPPED);
        assertThat(ended.getStatus()).isEqualTo(CallStatus.CANCELLED);
        verify(statistics, never()).recordCompletedCall(any(), anyInt(), any(Instant.class));
    }

    @Test
    void failureBeforeConnectionIsMarkedFailed() {
        assertThat(service.end(callId, null, EndReason.TIMEOUT).getStatus()).isEqualTo(CallStatus.FAILED);
    }

    @Test
    void endingTwiceIsIdempotentAndCountsStatisticsOnce() {
        service.reportConnected(callId, alice);
        service.reportConnected(callId, bob);
        clock.advance(Duration.ofSeconds(60));
        service.end(callId, alice, EndReason.ENDED);
        service.end(callId, bob, EndReason.ENDED);
        verify(statistics, times(1)).recordCompletedCall(eq(alice), eq(60), any(Instant.class));
    }

    @Test
    void reconnectingThenRecoveredReturnsToConnected() {
        service.reportConnected(callId, alice);
        service.reportConnected(callId, bob);
        service.reportReconnecting(callId, alice);
        assertThat(session.getStatus()).isEqualTo(CallStatus.RECONNECTING);
        service.reportConnected(callId, bob);
        assertThat(session.getStatus()).isEqualTo(CallStatus.CONNECTED);
    }

    @Test
    void callThatDroppedWhileReconnectingStillCountsAsCompleted() {
        service.reportConnected(callId, alice);
        service.reportConnected(callId, bob);
        clock.advance(Duration.ofSeconds(30));
        service.reportReconnecting(callId, alice);
        assertThat(service.end(callId, alice, EndReason.DISCONNECTED).getStatus()).isEqualTo(CallStatus.COMPLETED);
    }

    @Test
    void strangersCannotControlOrReadACall() {
        UUID mallory = UUID.randomUUID();
        assertThatThrownBy(() -> service.end(callId, mallory, EndReason.ENDED)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.reportConnected(callId, mallory)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.getForParticipant(callId, mallory)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.partnerOf(callId, mallory)).isInstanceOf(ApiException.class);
        assertThat(session.getStatus()).isEqualTo(CallStatus.MATCH_FOUND);
    }

    @Test
    void partnerIsTheOtherParticipant() {
        assertThat(service.partnerOf(callId, alice)).isEqualTo(bob);
    }

    @Test
    void firstOfferMovesCallToConnectingOnce() {
        service.markOfferRelayed(callId);
        service.markOfferRelayed(callId);
        assertThat(session.getStatus()).isEqualTo(CallStatus.CONNECTING);
        verify(events, times(1)).publishEvent(any(CallEvents.StateChanged.class));
    }

    @Test
    void cannotCreateCallWithSelfOrBusyUser() {
        assertThatThrownBy(() -> service.createMatchedCall(UUID.randomUUID(), alice, alice, null)).isInstanceOf(ApiException.class);
        when(sessions.countActiveForUsers(any(), any())).thenReturn(1L);
        assertThatThrownBy(() -> service.createMatchedCall(UUID.randomUUID(), alice, bob, null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("ALREADY_IN_CALL"));
    }

    @Test
    void createMatchedCallPublishesMatchFoundWithBothParticipants() {
        when(sessions.countActiveForUsers(any(), any())).thenReturn(0L);
        when(sessions.save(any(CallSession.class))).thenAnswer(i -> i.getArgument(0));
        UUID id = UUID.randomUUID();
        service.createMatchedCall(id, alice, bob, null);
        verify(participants).saveAll(argThat(list -> ((java.util.Collection<?>) list).size() == 2));
        verify(events).publishEvent(new CallEvents.MatchFound(id, alice, bob, null));
    }
}
