package com.englishspeaking.platform.partners;

import com.englishspeaking.platform.calling.CallSessionRepository;
import com.englishspeaking.platform.calling.CallStatus;
import com.englishspeaking.platform.moderation.ModerationService;
import com.englishspeaking.platform.preferences.UserPreferences;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.EnglishLevel;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import com.englishspeaking.platform.user.UserStatus;
import com.englishspeaking.platform.friends.FriendRequestRepository;
import com.englishspeaking.platform.friends.FriendRequestStatus;
import com.englishspeaking.platform.friends.FriendshipRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

/**
 * People the user has genuinely talked to in a random call (connected for at least 15 seconds), with what they chose to share and
 * where they stand as a friend. Block lists are honoured in both directions. Previous partners stay eligible for random matching.
 */
@Service
public class PartnerService {
    static final int MIN_CALL_SECONDS = 15;
    static final int MAX_PARTNERS = 100;

    /** Where this person stands with the viewer: nothing yet, a request in one direction, or already friends. */
    public enum FriendStatus { NONE, REQUEST_SENT, REQUEST_RECEIVED, FRIENDS }

    public record PartnerSummary(String ref, String displayName, EnglishLevel englishLevel, String country, int conversations,
                                 Instant lastConversationAt, UUID lastCallId, FriendStatus friendStatus, boolean canAddFriend) {}

    /** What a person has agreed to show another person: never email, id or other account details. */
    public record PartnerView(String displayName, String country, EnglishLevel englishLevel) {}

    private record SharedCall(UUID callId, Instant endedAt) {}

    private final UserRepository users;
    private final UserProfileRepository profiles;
    private final UserPreferencesRepository preferences;
    private final CallSessionRepository sessions;
    private final ModerationService moderation;
    private final PartnerRefs refs;
    private final FriendshipRepository friendships;
    private final FriendRequestRepository friendRequests;

    public PartnerService(UserRepository users, UserProfileRepository profiles, UserPreferencesRepository preferences,
                          CallSessionRepository sessions, ModerationService moderation, PartnerRefs refs,
                          FriendshipRepository friendships, FriendRequestRepository friendRequests) {
        this.users = users;
        this.profiles = profiles;
        this.preferences = preferences;
        this.sessions = sessions;
        this.moderation = moderation;
        this.refs = refs;
        this.friendships = friendships;
        this.friendRequests = friendRequests;
    }

    @Transactional(readOnly = true)
    public List<PartnerSummary> list(UUID me) {
        Map<UUID, List<SharedCall>> byPartner = sharedCalls(me);
        if (byPartner.isEmpty()) return List.of();
        Set<UUID> blocked = moderation.excludedPartners(me);
        Map<UUID, User> accounts = new HashMap<>();
        users.findAllById(byPartner.keySet()).forEach(u -> accounts.put(u.getId(), u));
        Map<UUID, UserProfile> profileById = new HashMap<>();
        profiles.findAllById(byPartner.keySet()).forEach(p -> profileById.put(p.getUserId(), p));
        Map<UUID, UserPreferences> prefsById = new HashMap<>();
        preferences.findAllById(byPartner.keySet()).forEach(p -> prefsById.put(p.getUserId(), p));
        Set<UUID> friendIds = new HashSet<>();
        friendships.findAllFor(me).forEach(f -> friendIds.add(f.getId().other(me)));
        Set<UUID> sent = new HashSet<>(), received = new HashSet<>();
        friendRequests.findByRequesterIdAndStatus(me, FriendRequestStatus.PENDING).forEach(r -> sent.add(r.getTargetId()));
        friendRequests.findByTargetIdAndStatus(me, FriendRequestStatus.PENDING).forEach(r -> received.add(r.getRequesterId()));

        List<PartnerSummary> out = new ArrayList<>();
        for (Map.Entry<UUID, List<SharedCall>> e : byPartner.entrySet()) {
            UUID id = e.getKey();
            User account = accounts.get(id);
            if (account == null || account.getStatus() != UserStatus.ACTIVE || blocked.contains(id)) continue;
            UserPreferences prefs = prefsById.get(id);
            FriendStatus status = friendIds.contains(id) ? FriendStatus.FRIENDS
                    : sent.contains(id) ? FriendStatus.REQUEST_SENT : received.contains(id) ? FriendStatus.REQUEST_RECEIVED : FriendStatus.NONE;
            SharedCall last = e.getValue().get(0);
            PartnerView view = view(profileById.get(id), prefs);
            out.add(new PartnerSummary(refs.refFor(me, id), view.displayName(), view.englishLevel(), view.country(), e.getValue().size(),
                    last.endedAt(), last.callId(), status, status == FriendStatus.NONE));
            if (out.size() >= MAX_PARTNERS) break;
        }
        return out;
    }

    /** Resolves an opaque handle back to a partner of {@code me}; empty if it is not (or no longer) one of theirs. */
    @Transactional(readOnly = true)
    public Optional<UUID> resolve(UUID me, String ref) {
        return sharedCalls(me).keySet().stream().filter(id -> refs.matches(me, id, ref)).findFirst();
    }

    /** True if the two have completed a call together, i.e. a request between them is legitimate. */
    @Transactional(readOnly = true)
    public boolean arePartners(UUID a, UUID b) { return sharedCalls(a).containsKey(b); }

    public PartnerView view(UUID partnerId) {
        return view(profiles.findById(partnerId).orElse(null), preferences.findById(partnerId).orElse(null));
    }

    /** {@link #view(UUID)} for many people with two queries in total, not two per person. Every id gets an entry. */
    public Map<UUID, PartnerView> views(Collection<UUID> partnerIds) {
        if (partnerIds.isEmpty()) return Map.of();
        Map<UUID, UserProfile> profileById = new HashMap<>();
        profiles.findAllById(partnerIds).forEach(p -> profileById.put(p.getUserId(), p));
        Map<UUID, UserPreferences> prefsById = new HashMap<>();
        preferences.findAllById(partnerIds).forEach(p -> prefsById.put(p.getUserId(), p));
        Map<UUID, PartnerView> out = new HashMap<>();
        for (UUID id : partnerIds) out.put(id, view(profileById.get(id), prefsById.get(id)));
        return out;
    }

    private PartnerView view(UserProfile profile, UserPreferences prefs) {
        String name = profile == null ? "Partner" : profile.getDisplayName();
        String country = profile != null && prefs != null && prefs.isShowCountry() ? profile.getCountry() : null;
        EnglishLevel level = profile != null && prefs != null && prefs.isShowLevel() ? profile.getEnglishLevel() : null;
        return new PartnerView(name, country, level);
    }

    /** Newest call first per partner; partners ordered by their most recent shared call. */
    private Map<UUID, List<SharedCall>> sharedCalls(UUID me) {
        List<Object[]> rows = sessions.findSharedCalls(me, CallStatus.COMPLETED, MIN_CALL_SECONDS, PageRequest.of(0, 500));
        Map<UUID, List<SharedCall>> byPartner = new LinkedHashMap<>();
        for (Object[] r : rows) {
            byPartner.computeIfAbsent((UUID) r[0], k -> new ArrayList<>()).add(new SharedCall((UUID) r[1], (Instant) r[2]));
        }
        return byPartner;
    }
}
