package com.englishspeaking.platform.calling;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.statistics.StatisticsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Owns the persistent call lifecycle. Every mutation locks the call row so both participants' actions serialise. */
@Service
public class CallService {
    private static final Logger log = LoggerFactory.getLogger(CallService.class);
    private final CallSessionRepository sessions;
    private final CallParticipantRepository participants;
    private final StatisticsService statistics;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public CallService(CallSessionRepository sessions, CallParticipantRepository participants, StatisticsService statistics,
                       ApplicationEventPublisher events, Clock clock) {
        this.sessions = sessions;
        this.participants = participants;
        this.statistics = statistics;
        this.events = events;
        this.clock = clock;
    }

    @Transactional
    public CallSession createMatchedCall(UUID callId, UUID initiatorId, UUID otherId, UUID topicId) {
        return createMatchedCall(callId, initiatorId, otherId, topicId, CallKind.RANDOM);
    }

    @Transactional
    public CallSession createMatchedCall(UUID callId, UUID initiatorId, UUID otherId, UUID topicId, CallKind kind) {
        if (initiatorId.equals(otherId)) throw ApiException.badRequest("SELF_MATCH", "Cannot start a call with yourself.");
        if (sessions.countActiveForUsers(List.of(initiatorId, otherId), CallStatus.activeStatuses()) > 0) {
            throw ApiException.conflict("ALREADY_IN_CALL", "A participant is already in an active call.");
        }
        log.info("call-created call={} initiator={} other={}", callId, initiatorId.toString().substring(0, 8), otherId.toString().substring(0, 8));
        CallSession session = sessions.save(new CallSession(callId, topicId, clock.instant(), kind));
        participants.saveAll(List.of(new CallParticipant(callId, initiatorId), new CallParticipant(callId, otherId)));
        events.publishEvent(new CallEvents.MatchFound(callId, initiatorId, otherId, topicId, kind));
        return session;
    }

    /** The first offer moves the call from MATCH_FOUND to CONNECTING. Idempotent. */
    @Transactional
    public void markOfferRelayed(UUID callId) {
        CallSession call = lock(callId);
        if (call.getStatus() == CallStatus.MATCH_FOUND) {
            call.transitionTo(CallStatus.CONNECTING);
            publish(call, null);
        }
    }

    /** Both peers must report an established media connection before the call counts as CONNECTED. */
    @Transactional
    public CallSession reportConnected(UUID callId, UUID userId) {
        CallSession call = lock(callId);
        List<CallParticipant> people = requireParticipant(callId, userId);
        Instant now = clock.instant();
        people.stream().filter(p -> p.getUserId().equals(userId)).forEach(p -> p.markJoined(now));
        CallStatus before = call.getStatus();
        if (before == CallStatus.RECONNECTING) {
            call.markConnected(now);
        } else if (before == CallStatus.MATCH_FOUND || before == CallStatus.CONNECTING) {
            if (people.stream().allMatch(p -> p.getJoinedAt() != null)) {
                if (before == CallStatus.MATCH_FOUND) call.transitionTo(CallStatus.CONNECTING);
                call.markConnected(now);
            }
        }
        log.info("call-connected-report call={} user={} before={} after={}", callId, userId.toString().substring(0, 8), before, call.getStatus());
        if (call.getStatus() != before) publish(call, null);
        return call;
    }

    @Transactional
    public void reportReconnecting(UUID callId, UUID userId) {
        CallSession call = lock(callId);
        requireParticipant(callId, userId);
        if (call.getStatus() == CallStatus.CONNECTED) {
            call.transitionTo(CallStatus.RECONNECTING);
            publish(call, null);
        }
    }

    /**
     * Ends the call. A call that never connected is CANCELLED (or FAILED for failures); one that did connect is
     * COMPLETED and its duration feeds both participants' statistics. Ending a finished call is a no-op.
     */
    @Transactional
    public CallSession end(UUID callId, UUID endedBy, EndReason reason) {
        CallSession call = lock(callId);
        if (call.getStatus().isTerminal()) return call;
        if (endedBy != null) requireParticipant(callId, endedBy);
        Instant now = clock.instant();
        CallStatus terminal;
        if (call.getConnectedAt() != null) terminal = CallStatus.COMPLETED;
        else terminal = (reason == EndReason.FAILED || reason == EndReason.TIMEOUT) ? CallStatus.FAILED : CallStatus.CANCELLED;
        log.info("call-end call={} by={} reason={} -> {} (was {})", callId, endedBy == null ? "system" : endedBy.toString().substring(0, 8), reason, terminal, call.getStatus());
        call.finish(terminal, reason, now);
        List<CallParticipant> people = participants.findByCallId(callId);
        people.forEach(p -> p.markLeft(now));
        if (terminal == CallStatus.COMPLETED) {
            int seconds = call.getDurationSeconds() == null ? 0 : call.getDurationSeconds();
            people.forEach(p -> statistics.recordCompletedCall(p.getUserId(), seconds, now));
        }
        publish(call, endedBy);
        return call;
    }

    @Transactional(readOnly = true)
    public CallSession getForParticipant(UUID callId, UUID userId) {
        CallSession call = sessions.findById(callId).orElseThrow(() -> ApiException.notFound("CALL_NOT_FOUND", "Call not found."));
        requireParticipant(callId, userId);
        return call;
    }

    @Transactional(readOnly = true)
    public UUID partnerOf(UUID callId, UUID userId) {
        List<CallParticipant> people = requireParticipant(callId, userId);
        return people.stream().map(CallParticipant::getUserId).filter(id -> !id.equals(userId)).findFirst()
                .orElseThrow(() -> ApiException.notFound("CALL_NOT_FOUND", "Call not found."));
    }

    @Transactional(readOnly = true)
    public Optional<CallSession> activeCallOf(UUID userId) {
        return sessions.findActiveForUser(userId, CallStatus.activeStatuses()).stream().findFirst();
    }

    @Transactional(readOnly = true)
    public List<UUID> participantIds(UUID callId) {
        return participants.findByCallId(callId).stream().map(CallParticipant::getUserId).toList();
    }

    private CallSession lock(UUID callId) {
        return sessions.findByIdForUpdate(callId).orElseThrow(() -> ApiException.notFound("CALL_NOT_FOUND", "Call not found."));
    }

    private List<CallParticipant> requireParticipant(UUID callId, UUID userId) {
        List<CallParticipant> people = participants.findByCallId(callId);
        if (people.stream().noneMatch(p -> p.getUserId().equals(userId))) {
            throw ApiException.notFound("CALL_NOT_FOUND", "Call not found.");
        }
        return people;
    }

    private void publish(CallSession call, UUID endedBy) {
        events.publishEvent(new CallEvents.StateChanged(call.getId(), call.getStatus(), call.getEndReason(), endedBy,
                call.getDurationSeconds(), participantIds(call.getId())));
    }
}
