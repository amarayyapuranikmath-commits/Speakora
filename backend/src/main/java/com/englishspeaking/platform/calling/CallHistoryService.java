package com.englishspeaking.platform.calling;

import com.englishspeaking.platform.common.PageResponse;
import com.englishspeaking.platform.feedback.CallFeedback;
import com.englishspeaking.platform.feedback.CallFeedbackRepository;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.topics.Topic;
import com.englishspeaking.platform.topics.TopicRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/** Read model for call history. Exposes only the partner's display name, never ids or contact details. */
@Service
@Transactional(readOnly = true)
public class CallHistoryService {
    public record CallSummary(UUID id, String partnerDisplayName, String topicName, CallStatus status, EndReason endReason,
                              Instant startedAt, Integer durationSeconds, boolean feedbackSubmitted) {}

    private static final Set<CallStatus> HISTORY_STATUSES = EnumSet.of(CallStatus.COMPLETED, CallStatus.FAILED, CallStatus.CANCELLED);

    private final CallSessionRepository sessions;
    private final CallParticipantRepository participants;
    private final UserProfileRepository profiles;
    private final CallFeedbackRepository feedback;
    private final TopicRepository topics;

    public CallHistoryService(CallSessionRepository sessions, CallParticipantRepository participants, UserProfileRepository profiles,
                              CallFeedbackRepository feedback, TopicRepository topics) {
        this.sessions = sessions;
        this.participants = participants;
        this.profiles = profiles;
        this.feedback = feedback;
        this.topics = topics;
    }

    public PageResponse<CallSummary> history(UUID userId, int page, int size) {
        Page<CallSession> result = sessions.findForUser(userId, HISTORY_STATUSES, PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 50)));
        return PageResponse.of(result, summarise(userId, result.getContent()));
    }

    public CallSummary detail(UUID userId, UUID callId, CallSession session) {
        return summarise(userId, List.of(session)).get(0);
    }

    private List<CallSummary> summarise(UUID userId, List<CallSession> calls) {
        if (calls.isEmpty()) return List.of();
        List<UUID> callIds = calls.stream().map(CallSession::getId).toList();
        Map<UUID, UUID> partnerByCall = new HashMap<>();
        participants.findByCallIds(callIds).stream().filter(p -> !p.getUserId().equals(userId))
                .forEach(p -> partnerByCall.put(p.getId().callId(), p.getUserId()));
        Map<UUID, String> names = profiles.findAllById(new HashSet<>(partnerByCall.values())).stream()
                .collect(Collectors.toMap(UserProfile::getUserId, UserProfile::getDisplayName));
        Set<UUID> withFeedback = feedback.findByAuthorIdAndCallIdIn(userId, callIds).stream().map(CallFeedback::getCallId).collect(Collectors.toSet());
        Map<UUID, String> topicNames = topics.findAllById(calls.stream().map(CallSession::getTopicId).filter(Objects::nonNull).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(Topic::getId, Topic::getName));
        return calls.stream().map(c -> new CallSummary(c.getId(),
                names.getOrDefault(partnerByCall.get(c.getId()), "Deleted user"),
                c.getTopicId() == null ? null : topicNames.get(c.getTopicId()),
                c.getStatus(), c.getEndReason(), c.getConnectedAt() != null ? c.getConnectedAt() : c.getCreatedAt(),
                c.getDurationSeconds(), withFeedback.contains(c.getId()))).toList();
    }
}
