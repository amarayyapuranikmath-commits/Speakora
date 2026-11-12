package com.englishspeaking.platform.feedback;

import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.calling.CallSession;
import com.englishspeaking.platform.calling.CallStatus;
import com.englishspeaking.platform.common.ApiException;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class FeedbackService {
    public record FeedbackRequest(@NotNull @Min(1) @Max(5) Integer rating, Boolean partnerWasRespectful,
                                  @Size(max = 1000) String comment) {}

    private final CallFeedbackRepository feedback;
    private final CallService calls;

    public FeedbackService(CallFeedbackRepository feedback, CallService calls) {
        this.feedback = feedback;
        this.calls = calls;
    }

    @Transactional
    public void submit(UUID callId, UUID userId, FeedbackRequest req) {
        CallSession call = calls.getForParticipant(callId, userId);
        if (call.getStatus() != CallStatus.COMPLETED) {
            throw ApiException.conflict("CALL_NOT_COMPLETED", "Feedback can only be left for completed calls.");
        }
        if (feedback.existsByCallIdAndAuthorId(callId, userId)) {
            throw ApiException.conflict("FEEDBACK_EXISTS", "You have already submitted feedback for this call.");
        }
        String comment = req.comment() == null || req.comment().isBlank() ? null : req.comment().trim();
        try {
            feedback.saveAndFlush(new CallFeedback(callId, userId, req.rating().shortValue(), req.partnerWasRespectful(), comment));
        } catch (DataIntegrityViolationException e) { // concurrent duplicate caught by the unique constraint
            throw ApiException.conflict("FEEDBACK_EXISTS", "You have already submitted feedback for this call.");
        }
    }
}
