package com.englishspeaking.platform.feedback;

import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.calling.CallSession;
import com.englishspeaking.platform.calling.EndReason;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.feedback.FeedbackService.FeedbackRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FeedbackServiceTest {
    @Mock CallFeedbackRepository repo;
    @Mock CallService calls;
    FeedbackService service;
    final UUID callId = UUID.randomUUID();
    final UUID user = UUID.randomUUID();

    @BeforeEach
    void setUp() { service = new FeedbackService(repo, calls); }

    private CallSession call(boolean completed) {
        Instant t = Instant.parse("2026-11-09T10:00:00Z");
        CallSession s = new CallSession(callId, null, t);
        if (completed) {
            s.transitionTo(com.englishspeaking.platform.calling.CallStatus.CONNECTING);
            s.markConnected(t);
            s.finish(com.englishspeaking.platform.calling.CallStatus.COMPLETED, EndReason.ENDED, t.plusSeconds(60));
        }
        return s;
    }

    @Test
    void savesFeedbackForCompletedCall() {
        when(calls.getForParticipant(callId, user)).thenReturn(call(true));
        service.submit(callId, user, new FeedbackRequest(4, true, "  Great chat  "));
        ArgumentCaptor<CallFeedback> saved = ArgumentCaptor.forClass(CallFeedback.class);
        verify(repo).saveAndFlush(saved.capture());
        assertThat(saved.getValue().getRating()).isEqualTo((short) 4);
        assertThat(saved.getValue().getCallId()).isEqualTo(callId);
    }

    @Test
    void rejectsFeedbackForUnfinishedOrCancelledCalls() {
        when(calls.getForParticipant(callId, user)).thenReturn(call(false));
        assertThatThrownBy(() -> service.submit(callId, user, new FeedbackRequest(5, null, null)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("CALL_NOT_COMPLETED"));
        verify(repo, never()).saveAndFlush(any());
    }

    @Test
    void rejectsDuplicateFeedback() {
        when(calls.getForParticipant(callId, user)).thenReturn(call(true));
        when(repo.existsByCallIdAndAuthorId(callId, user)).thenReturn(true);
        assertThatThrownBy(() -> service.submit(callId, user, new FeedbackRequest(5, null, null)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("FEEDBACK_EXISTS"));
    }

    @Test
    void concurrentDuplicateIsCaughtByUniqueConstraint() {
        when(calls.getForParticipant(callId, user)).thenReturn(call(true));
        when(repo.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("uq_feedback_call_author"));
        assertThatThrownBy(() -> service.submit(callId, user, new FeedbackRequest(5, null, null)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("FEEDBACK_EXISTS"));
    }

    @Test
    void nonParticipantsAreRefused() {
        when(calls.getForParticipant(callId, user)).thenThrow(ApiException.notFound("CALL_NOT_FOUND", "Call not found."));
        assertThatThrownBy(() -> service.submit(callId, user, new FeedbackRequest(5, null, null))).isInstanceOf(ApiException.class);
        verify(repo, never()).saveAndFlush(any());
    }
}
