package com.englishspeaking.platform.partners;

import com.englishspeaking.platform.auth.AuthService;
import com.englishspeaking.platform.calling.CallKind;
import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.friends.FriendService;
import com.englishspeaking.platform.friends.FriendshipEndedEvent;
import com.englishspeaking.platform.matching.MatchmakingStore;
import com.englishspeaking.platform.moderation.ModerationService;
import com.englishspeaking.platform.moderation.UserBlockedEvent;
import com.englishspeaking.platform.preferences.UserPreferences;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import com.englishspeaking.platform.user.UserStatus;
import com.englishspeaking.platform.websocket.SessionRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Private calls between accepted friends, and only between them. A request is only ever an invitation: the other person is told in real time and must accept,
 * and a call exists only after they do. Accepting reuses the normal call creation, so signalling and the call state machine
 * behave exactly as for a random match.
 *
 * <p>Messages to clients are sent only after the database change has committed.
 */
@Service
public class ConnectionRequestService {
    private static final Logger log = LoggerFactory.getLogger(ConnectionRequestService.class);

    static final Duration REQUEST_TTL = Duration.ofSeconds(45);
    static final Duration DECLINE_COOLDOWN = Duration.ofSeconds(60);
    static final Duration RATE_WINDOW = Duration.ofMinutes(10);
    public static final int MAX_REQUESTS_PER_WINDOW = 10;

    private record Notice(UUID to, Map<String, Object> payload) {}

    private final PartnerRequestRepository requests;
    private final PartnerService partners;
    private final FriendService friends;
    private final UserRepository users;
    private final UserPreferencesRepository preferences;
    private final ModerationService moderation;
    private final CallService calls;
    private final MatchmakingStore store;
    private final SessionRegistry registry;
    private final TransactionTemplate tx;
    private final Clock clock;

    public ConnectionRequestService(PartnerRequestRepository requests, PartnerService partners, FriendService friends, UserRepository users,
                                    UserPreferencesRepository preferences, ModerationService moderation, CallService calls,
                                    MatchmakingStore store, SessionRegistry registry, PlatformTransactionManager txManager, Clock clock) {
        this.requests = requests;
        this.partners = partners;
        this.friends = friends;
        this.users = users;
        this.preferences = preferences;
        this.moderation = moderation;
        this.calls = calls;
        this.store = store;
        this.registry = registry;
        this.tx = new TransactionTemplate(txManager);
        this.clock = clock;
    }

    // ---------------------------------------------------------------- requester side

    /** Asks a friend (identified by the opaque friend handle) for a private call. Anyone who is not an accepted friend is refused. */
    public void request(UUID me, String friendRef) {
        User user = users.findById(me).orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again."));
        AuthService.requireActive(user);
        if (!user.isOnboardingCompleted()) throw ApiException.conflict("ONBOARDING_REQUIRED", "Complete your profile first.");
        if (calls.activeCallOf(me).isPresent()) throw ApiException.conflict("ALREADY_IN_CALL", "You are already in a call.");
        UUID target = friends.resolveFriend(me, friendRef) // also refuses anyone blocked in either direction
                .orElseThrow(() -> ApiException.notFound("FRIEND_NOT_FOUND", "Only friends can call each other privately."));

        Instant now = clock.instant();
        if (requests.countSince(me, now.minus(RATE_WINDOW)) >= MAX_REQUESTS_PER_WINDOW) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "REQUEST_LIMIT", "You have sent a lot of requests. Please wait a few minutes.");
        }
        List<PartnerRequest> declined = requests.findDeclinedSince(me, target, now.minus(DECLINE_COOLDOWN));
        if (!declined.isEmpty()) {
            long left = Math.max(1, DECLINE_COOLDOWN.minus(Duration.between(declined.get(0).getRespondedAt(), now)).toSeconds());
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "REQUEST_COOLDOWN", "They are not available right now. You can ask again in " + left + " seconds.");
        }
        String unavailable = unavailableReason(target, me);
        if (unavailable != null) {
            registry.send(me, status(null, "UNAVAILABLE", unavailable));
            return;
        }
        store.remove(me); // do not let a random match take you while you wait for an answer

        List<Notice> notices = tx.execute(s -> {
            List<Notice> out = new ArrayList<>();
            // Both sides asked for each other: that is mutual consent, connect them right away.
            for (PartnerRequest reverse : requests.findByRequesterIdAndTargetIdAndStatus(target, me, PartnerRequestStatus.PENDING)) {
                PartnerRequest locked = requests.findByIdForUpdate(reverse.getId()).orElse(null);
                if (locked != null && locked.isPending() && !locked.isExpiredAt(now)) {
                    out.addAll(acceptLocked(locked, me, now));
                    return out;
                }
            }
            for (PartnerRequest mine : requests.findByRequesterIdAndStatus(me, PartnerRequestStatus.PENDING)) {
                PartnerRequest locked = requests.findByIdForUpdate(mine.getId()).orElse(null);
                if (locked == null || !locked.isPending()) continue;
                if (locked.getTargetId().equals(target) && !locked.isExpiredAt(now)) { // same ask again: just show it again
                    out.add(ringing(locked));
                    return out;
                }
                locked.close(PartnerRequestStatus.CANCELLED, now); // one outstanding request at a time
                out.add(new Notice(locked.getTargetId(), closed(locked.getId(), "CANCELLED")));
            }
            PartnerRequest created = requests.save(new PartnerRequest(UUID.randomUUID(), me, target, now, now.plus(REQUEST_TTL)));
            out.add(incoming(created));
            out.add(ringing(created));
            return out;
        });
        send(notices);
    }

    /** The requester withdraws a request that has not been answered. */
    public void cancel(UUID me, UUID requestId) {
        send(tx.execute(s -> {
            PartnerRequest r = requests.findByIdForUpdate(requestId).orElse(null);
            if (r == null || !r.getRequesterId().equals(me) || !r.isPending()) return List.<Notice>of();
            r.close(PartnerRequestStatus.CANCELLED, clock.instant());
            return List.of(new Notice(r.getTargetId(), closed(r.getId(), "CANCELLED")));
        }));
    }

    /** Called when someone starts a random search or leaves: any request they had out is withdrawn. */
    public void cancelOutgoing(UUID me) {
        send(tx.execute(s -> closePending(requests.findByRequesterIdAndStatus(me, PartnerRequestStatus.PENDING), PartnerRequestStatus.CANCELLED, null, null)));
    }

    // ---------------------------------------------------------------- target side

    /** The target says yes: they are connected immediately, with no further step. */
    public void accept(UUID me, UUID requestId) {
        send(tx.execute(s -> {
            PartnerRequest r = requests.findByIdForUpdate(requestId)
                    .filter(found -> found.getTargetId().equals(me))
                    .orElseThrow(() -> ApiException.notFound("REQUEST_NOT_FOUND", "That request does not exist."));
            Instant now = clock.instant();
            if (!r.isPending()) throw ApiException.conflict("REQUEST_CLOSED", "That request is no longer open.");
            if (r.isExpiredAt(now)) {
                r.close(PartnerRequestStatus.EXPIRED, now);
                return List.of(new Notice(r.getRequesterId(), status(r.getId(), "EXPIRED", null)));
            }
            return acceptLocked(r, me, now);
        }));
    }

    public void decline(UUID me, UUID requestId) {
        send(tx.execute(s -> {
            PartnerRequest r = requests.findByIdForUpdate(requestId).filter(found -> found.getTargetId().equals(me)).orElse(null);
            if (r == null || !r.isPending()) return List.<Notice>of();
            r.close(PartnerRequestStatus.DECLINED, clock.instant());
            return List.of(new Notice(r.getRequesterId(), status(r.getId(), "DECLINED", null)));
        }));
    }

    // ---------------------------------------------------------------- housekeeping

    /** Requests nobody answered expire, and both people are told. */
    @Scheduled(fixedDelay = 3000)
    public void expireOld() {
        try {
            for (UUID id : requests.findExpiredPendingIds(clock.instant())) {
                send(tx.execute(s -> {
                    PartnerRequest r = requests.findByIdForUpdate(id).orElse(null);
                    if (r == null || !r.isPending()) return List.<Notice>of();
                    r.close(PartnerRequestStatus.EXPIRED, clock.instant());
                    return List.of(new Notice(r.getRequesterId(), status(r.getId(), "EXPIRED", null)), new Notice(r.getTargetId(), closed(r.getId(), "EXPIRED")));
                }));
            }
        } catch (RuntimeException e) {
            log.warn("Expiring partner requests failed: {}", e.getMessage());
        }
    }

    /** A user's socket closed: whatever they had out is withdrawn, and whoever was asking them is told they went away. */
    public void onDisconnect(UUID userId) {
        try {
            send(tx.execute(s -> {
                List<Notice> out = new ArrayList<>(closePending(requests.findByRequesterIdAndStatus(userId, PartnerRequestStatus.PENDING), PartnerRequestStatus.CANCELLED, null, null));
                out.addAll(closePending(requests.findByTargetIdAndStatus(userId, PartnerRequestStatus.PENDING), PartnerRequestStatus.UNAVAILABLE, "UNAVAILABLE", "OFFLINE"));
                return out;
            }));
        } catch (RuntimeException e) {
            log.warn("Could not clean up partner requests for a disconnected user: {}", e.getMessage());
        }
    }

    /** Blocking someone ends any open request between the two, in both directions. */
    @EventListener
    void onBlocked(UserBlockedEvent event) {
        List<PartnerRequest> open = new ArrayList<>(requests.findByRequesterIdAndTargetIdAndStatus(event.blockerId(), event.blockedId(), PartnerRequestStatus.PENDING));
        open.addAll(requests.findByRequesterIdAndTargetIdAndStatus(event.blockedId(), event.blockerId(), PartnerRequestStatus.PENDING));
        // The requester is only told "unavailable": they are not told that they were blocked.
        send(closePending(open, PartnerRequestStatus.CANCELLED, "UNAVAILABLE", "UNAVAILABLE"));
    }

    /** Ending a friendship withdraws any call invitation between the two. */
    @EventListener
    void onFriendshipEnded(FriendshipEndedEvent event) {
        List<PartnerRequest> open = new ArrayList<>(requests.findByRequesterIdAndTargetIdAndStatus(event.a(), event.b(), PartnerRequestStatus.PENDING));
        open.addAll(requests.findByRequesterIdAndTargetIdAndStatus(event.b(), event.a(), PartnerRequestStatus.PENDING));
        send(closePending(open, PartnerRequestStatus.CANCELLED, "UNAVAILABLE", "UNAVAILABLE"));
    }

    // ---------------------------------------------------------------- internals

    /** Must run inside a transaction that holds the row lock of {@code r}. */
    private List<Notice> acceptLocked(PartnerRequest r, UUID acceptor, Instant now) {
        UUID requester = r.getRequesterId(), target = r.getTargetId();
        String blocker = unavailableReasonForAccept(requester, target);
        if (blocker != null) {
            r.close(PartnerRequestStatus.UNAVAILABLE, now);
            List<Notice> out = new ArrayList<>(List.of(new Notice(requester, status(r.getId(), "UNAVAILABLE", blocker))));
            out.add(new Notice(target, closed(r.getId(), blocker)));
            return out;
        }
        UUID callId = UUID.randomUUID();
        for (UUID u : List.of(requester, target)) store.activeCall(u).ifPresent(stale -> store.releaseCall(stale, List.of(u))); // DB says free: any marker is stale
        if (!store.claimDirect(requester, target, callId)) {
            r.close(PartnerRequestStatus.UNAVAILABLE, now);
            return List.of(new Notice(requester, status(r.getId(), "UNAVAILABLE", "BUSY")), new Notice(target, closed(r.getId(), "BUSY")));
        }
        try {
            calls.createMatchedCall(callId, requester, target, null, CallKind.PRIVATE); // publishes MatchFound: both clients get match.found after commit
            r.accept(callId, now);
        } catch (RuntimeException e) {
            store.releaseCall(callId, List.of(requester, target));
            throw e;
        }
        log.info("partner-request accepted request={} call={} acceptor={}", r.getId(), callId, acceptor.toString().substring(0, 8));
        return List.of();
    }

    /** Why the pair cannot be connected at the moment of acceptance, or null. */
    private String unavailableReasonForAccept(UUID requester, UUID target) {
        if (!registry.isConnected(requester) || !registry.isConnected(target)) return "OFFLINE";
        if (!friends.areFriends(requester, target)) return "NOT_FRIENDS";
        if (moderation.excludedPartners(requester).contains(target)) return "BLOCKED";
        for (UUID id : List.of(requester, target)) {
            User u = users.findById(id).orElse(null);
            if (u == null || u.getStatus() != UserStatus.ACTIVE) return "UNAVAILABLE";
            if (calls.activeCallOf(id).isPresent()) return "BUSY";
        }
        return null;
    }

    /** Why {@code target} cannot be asked right now, or null if they can. */
    private String unavailableReason(UUID target, UUID requester) {
        User t = users.findById(target).orElse(null);
        if (t == null || t.getStatus() != UserStatus.ACTIVE) return "UNAVAILABLE";
        UserPreferences prefs = preferences.findById(target).orElse(null);
        if (prefs != null && !prefs.isAllowPartnerRequests()) return "NOT_ACCEPTING";
        if (!registry.isConnected(target)) return "OFFLINE";
        if (calls.activeCallOf(target).isPresent()) return "BUSY";
        boolean askedByOthers = requests.findByTargetIdAndStatus(target, PartnerRequestStatus.PENDING).stream()
                .anyMatch(r -> !r.getRequesterId().equals(requester) && !r.isExpiredAt(clock.instant()));
        return askedByOthers ? "BUSY" : null;
    }

    /**
     * Closes each pending request with {@code outcome}. The target always gets a "closed" notice (so any prompt disappears); the
     * requester gets a status only when {@code requesterStatus} is given (a requester who withdrew needs no notice).
     */
    private List<Notice> closePending(List<PartnerRequest> pending, PartnerRequestStatus outcome, String requesterStatus, String reason) {
        List<Notice> out = new ArrayList<>();
        Instant now = clock.instant();
        for (PartnerRequest p : pending) {
            PartnerRequest r = requests.findByIdForUpdate(p.getId()).orElse(null);
            if (r == null || !r.isPending()) continue;
            r.close(outcome, now);
            out.add(new Notice(r.getTargetId(), closed(r.getId(), outcome.name())));
            if (requesterStatus != null) out.add(new Notice(r.getRequesterId(), status(r.getId(), requesterStatus, reason)));
        }
        return out;
    }

    private void send(List<Notice> notices) {
        if (notices == null) return;
        for (Notice n : notices) registry.send(n.to(), n.payload());
    }

    private Notice ringing(PartnerRequest r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", "connect.ringing");
        m.put("requestId", r.getId());
        m.put("expiresAt", r.getExpiresAt().toString());
        m.put("partner", partners.view(r.getTargetId()));
        return new Notice(r.getRequesterId(), m);
    }

    private Notice incoming(PartnerRequest r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", "connect.request");
        m.put("requestId", r.getId());
        m.put("expiresAt", r.getExpiresAt().toString());
        m.put("from", partners.view(r.getRequesterId()));
        return new Notice(r.getTargetId(), m);
    }

    private static Map<String, Object> status(UUID requestId, String status, String reason) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", "connect.status");
        m.put("requestId", requestId);
        m.put("status", status);
        m.put("reason", reason);
        return m;
    }

    private static Map<String, Object> closed(UUID requestId, String reason) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", "connect.closed");
        m.put("requestId", requestId);
        m.put("reason", reason);
        return m;
    }
}
