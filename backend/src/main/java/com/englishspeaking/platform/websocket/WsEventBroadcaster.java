package com.englishspeaking.platform.websocket;

import com.englishspeaking.platform.calling.CallEvents;
import com.englishspeaking.platform.calling.CallSession;
import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.matching.MatchmakingService;
import com.englishspeaking.platform.preferences.UserPreferences;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.topics.TopicRepository;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Pushes domain events to connected clients. Match/state events go out only after the DB transaction commits. */
@Component
public class WsEventBroadcaster {
    private final SessionRegistry registry;
    private final UserProfileRepository profiles;
    private final UserPreferencesRepository preferences;
    private final TopicRepository topics;
    private final CallService calls;

    public WsEventBroadcaster(SessionRegistry registry, UserProfileRepository profiles, UserPreferencesRepository preferences,
                              TopicRepository topics, CallService calls) {
        this.registry = registry;
        this.profiles = profiles;
        this.preferences = preferences;
        this.topics = topics;
        this.calls = calls;
    }

    @TransactionalEventListener(fallbackExecution = true)
    void onMatchFound(CallEvents.MatchFound event) {
        registry.rememberPair(event.callId(), event.initiatorId(), event.otherId());
        // Both people's profiles and preferences, and the topic, are read once for both messages (two queries, not six).
        java.util.List<UUID> both = java.util.List.of(event.initiatorId(), event.otherId());
        Preloaded pre = new Preloaded(
                profiles.findAllById(both).stream().collect(java.util.stream.Collectors.toMap(UserProfile::getUserId, p -> p)),
                preferences.findAllById(both).stream().collect(java.util.stream.Collectors.toMap(UserPreferences::getUserId, p -> p)),
                topicOf(event.topicId()));
        for (UUID[] pair : new UUID[][]{{event.initiatorId(), event.otherId()}, {event.otherId(), event.initiatorId()}}) {
            registry.send(pair[0], matchPayload("match.found", event.callId(), pair[0], pair[1], event.topicId(), null, event.kind(), pre));
        }
    }

    @TransactionalEventListener(fallbackExecution = true)
    void onStateChanged(CallEvents.StateChanged event) {
        if (event.status().isTerminal()) registry.forgetPair(event.callId());
        for (UUID userId : event.participantIds()) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("type", "call.state");
            payload.put("callId", event.callId());
            payload.put("status", event.status());
            payload.put("endReason", event.endReason());
            payload.put("durationSeconds", event.durationSeconds());
            payload.put("endedBy", event.endedBy() == null ? "system" : event.endedBy().equals(userId) ? "you" : "partner");
            registry.send(userId, payload);
        }
    }

    @EventListener
    void onSuspended(com.englishspeaking.platform.moderation.UserSuspendedEvent event) {
        registry.closeUser(event.userId(), "Account suspended");
    }

    @EventListener
    void onDeleted(com.englishspeaking.platform.user.AccountService.AccountDeletedEvent event) {
        registry.closeUser(event.userId(), "Account deleted");
    }

    @EventListener
    void onQueueTimeout(MatchmakingService.QueueTimedOut event) {
        registry.send(event.userId(), Map.of("type", "queue.timeout"));
    }

    /** Tells a (re)connecting client about the call it is still part of, so it can restore the UI and renegotiate. */
    public void sendResume(CallSession call, UUID userId) {
        UUID partner = calls.partnerOf(call.getId(), userId);
        registry.rememberPair(call.getId(), userId, partner);
        registry.send(userId, matchPayload("call.resume", call.getId(), userId, partner, call.getTopicId(), call.getStatus().name(), call.getKind(), null));
    }

    /** What the two match messages share, read once. */
    private record Preloaded(Map<UUID, UserProfile> profiles, Map<UUID, UserPreferences> preferences, Map<String, Object> topic) {}

    private Map<String, Object> topicOf(UUID topicId) {
        return topicId == null ? null : topics.findById(topicId).map(t -> Map.<String, Object>of("slug", t.getSlug(), "name", t.getName(), "prompts", t.getPrompts())).orElse(null);
    }

    private Map<String, Object> matchPayload(String type, UUID callId, UUID me, UUID partner, UUID topicId, String status,
                                            com.englishspeaking.platform.calling.CallKind kind, Preloaded pre) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", type);
        payload.put("kind", kind.name());
        payload.put("callId", callId);
        // Deterministic role: the lower id creates the offer, so a resumed call keeps the same roles.
        payload.put("initiator", me.compareTo(partner) < 0);
        if (status != null) payload.put("status", status);
        payload.put("topic", pre != null ? pre.topic() : topicOf(topicId));
        payload.put("partner", pre != null ? partnerView(pre.profiles().get(partner), pre.preferences().get(partner)) : partnerView(partner));
        return payload;
    }

    /** Only what the partner chose to share; never email, id or other account details. */
    private Map<String, Object> partnerView(UUID partner) {
        return partnerView(profiles.findById(partner).orElse(null), preferences.findById(partner).orElse(null));
    }

    private Map<String, Object> partnerView(UserProfile profile, UserPreferences prefs) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("displayName", profile == null ? "Partner" : profile.getDisplayName());
        if (profile != null && prefs != null) {
            if (prefs.isShowCountry() && profile.getCountry() != null) view.put("country", profile.getCountry());
            if (prefs.isShowLevel() && profile.getEnglishLevel() != null) view.put("englishLevel", profile.getEnglishLevel());
        }
        return view;
    }
}
