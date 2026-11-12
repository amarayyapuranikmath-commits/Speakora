package com.englishspeaking.platform.friends;

import com.englishspeaking.platform.auth.AuthService;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.moderation.ModerationService;
import com.englishspeaking.platform.moderation.UserBlockedEvent;
import com.englishspeaking.platform.partners.PartnerRefs;
import com.englishspeaking.platform.partners.PartnerService;
import com.englishspeaking.platform.profile.EnglishLevel;
import com.englishspeaking.platform.user.AccountService;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import com.englishspeaking.platform.user.UserStatus;
import com.englishspeaking.platform.websocket.SessionRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Friend requests and friendships. Requests are only possible towards people the user has genuinely talked to in a random call
 * (a previous partner), and are addressed through the opaque partner handle, so no user id is ever exposed.
 *
 * <p>Friendship is the single gate for private calls and private messages. Blocking removes it, in both directions, at once.
 * Declining a request has no effect on random matching.
 */
@Service
public class FriendService {
    private static final Logger log = LoggerFactory.getLogger(FriendService.class);

    public static final int MAX_FRIENDS = 200;
    public static final int MAX_REQUESTS_PER_DAY = 20;
    static final Duration DECLINE_COOLDOWN = Duration.ofDays(7);

    public record FriendSummary(String ref, String displayName, EnglishLevel englishLevel, String country, Instant since,
                                boolean online, int unread, Instant lastMessageAt) {}

    public record RequestSummary(UUID id, String displayName, EnglishLevel englishLevel, String country, Instant createdAt) {}

    public record Overview(List<FriendSummary> friends, List<RequestSummary> incoming, List<RequestSummary> outgoing) {}

    private final FriendRequestRepository requests;
    private final FriendshipRepository friendships;
    private final DirectMessageRepository messages;
    private final ConversationStateRepository states;
    private final PartnerService partners;
    private final PartnerRefs refs;
    private final ModerationService moderation;
    private final UserRepository users;
    private final SessionRegistry registry;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public FriendService(FriendRequestRepository requests, FriendshipRepository friendships, DirectMessageRepository messages,
                         ConversationStateRepository states, PartnerService partners, PartnerRefs refs, ModerationService moderation,
                         UserRepository users, SessionRegistry registry, ApplicationEventPublisher events, Clock clock) {
        this.requests = requests;
        this.friendships = friendships;
        this.messages = messages;
        this.states = states;
        this.partners = partners;
        this.refs = refs;
        this.moderation = moderation;
        this.users = users;
        this.registry = registry;
        this.events = events;
        this.clock = clock;
    }

    // ---------------------------------------------------------------- reading

    @Transactional(readOnly = true)
    public Overview overview(UUID me) {
        List<Friendship> mine = friendships.findAllFor(me);
        var blocked = moderation.excludedPartners(me);
        List<FriendRequest> pendingIn = requests.findByTargetIdAndStatus(me, FriendRequestStatus.PENDING);
        List<FriendRequest> pendingOut = requests.findByRequesterIdAndStatus(me, FriendRequestStatus.PENDING);

        // Everyone listed below is looked up together. This screen is polled by every signed-in client, and a query or two per
        // person made one refresh cost hundreds of statements for someone with a few dozen friends.
        Set<UUID> everyone = new HashSet<>();
        mine.forEach(f -> everyone.add(f.getId().other(me)));
        pendingIn.forEach(r -> everyone.add(r.getRequesterId()));
        pendingOut.forEach(r -> everyone.add(r.getTargetId()));
        Set<UUID> active = new HashSet<>();
        users.findAllById(everyone).forEach(u -> { if (u.getStatus() == UserStatus.ACTIVE) active.add(u.getId()); });
        Map<UUID, PartnerService.PartnerView> views = partners.views(everyone);
        Map<UUID, Activity> activity = mine.isEmpty() ? Map.of() : activityWithFriends(me);

        List<FriendSummary> friends = new ArrayList<>();
        for (Friendship f : mine) {
            UUID other = f.getId().other(me);
            if (blocked.contains(other) || !active.contains(other)) continue;
            PartnerService.PartnerView v = views.get(other);
            Activity a = activity.getOrDefault(other, Activity.NONE);
            friends.add(new FriendSummary(refs.friendRef(me, other), v.displayName(), v.englishLevel(), v.country(), f.getCreatedAt(),
                    registry.isConnected(other), (int) Math.min(a.unread(), 99), a.last()));
        }
        friends.sort(Comparator.comparing((FriendSummary s) -> s.lastMessageAt() == null ? s.since() : s.lastMessageAt()).reversed());

        List<RequestSummary> incoming = new ArrayList<>();
        for (FriendRequest r : pendingIn) {
            if (blocked.contains(r.getRequesterId()) || !active.contains(r.getRequesterId())) continue;
            incoming.add(summary(r, views.get(r.getRequesterId())));
        }
        List<RequestSummary> outgoing = new ArrayList<>();
        for (FriendRequest r : pendingOut) {
            if (blocked.contains(r.getTargetId()) || !active.contains(r.getTargetId())) continue;
            outgoing.add(summary(r, views.get(r.getTargetId())));
        }
        incoming.sort(Comparator.comparing(RequestSummary::createdAt).reversed());
        outgoing.sort(Comparator.comparing(RequestSummary::createdAt).reversed());
        return new Overview(friends, incoming, outgoing);
    }

    /** The friend behind a handle, if they are (still) an accepted friend and neither has blocked the other. */
    @Transactional(readOnly = true)
    public Optional<UUID> resolveFriend(UUID me, String friendRef) {
        if (friendRef == null) return Optional.empty();
        for (Friendship f : friendships.findAllFor(me)) {
            UUID other = f.getId().other(me);
            if (refs.matchesFriend(me, other, friendRef) && !moderation.isBlockedEitherWay(me, other) && isActive(other)) return Optional.of(other);
        }
        return Optional.empty();
    }

    /** Same, for a handle the caller may be removing even if the other person has since been blocked. */
    private Optional<UUID> resolveAnyFriend(UUID me, String friendRef) {
        if (friendRef == null) return Optional.empty();
        for (Friendship f : friendships.findAllFor(me)) {
            UUID other = f.getId().other(me);
            if (refs.matchesFriend(me, other, friendRef)) return Optional.of(other);
        }
        return Optional.empty();
    }

    @Transactional(readOnly = true)
    public boolean areFriends(UUID a, UUID b) { return friendships.existsById(Friendship.Key.of(a, b)); }

    /** True if the two are friends and nobody has blocked anybody. This is the rule for every private call and message. */
    @Transactional(readOnly = true)
    public boolean canContact(UUID a, UUID b) { return areFriends(a, b) && !moderation.isBlockedEitherWay(a, b) && isActive(b) && isActive(a); }

    // ---------------------------------------------------------------- requests

    /** Sends a friend request to a previous partner. If they had already asked, the two simply become friends. */
    @Transactional
    public void sendRequest(UUID me, String partnerRef) {
        User user = users.findById(me).orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again."));
        AuthService.requireActive(user);
        UUID target = partners.resolve(me, partnerRef).orElseThrow(this::notAPartner);
        if (moderation.isBlockedEitherWay(me, target) || !isActive(target)) throw notAPartner();
        if (areFriends(me, target)) throw ApiException.conflict("ALREADY_FRIENDS", "You are already friends.");

        Instant now = clock.instant();
        for (FriendRequest open : requests.findPendingBetween(me, target)) {
            if (open.getRequesterId().equals(me)) return; // already asked: nothing to do
            FriendRequest locked = requests.findByIdForUpdate(open.getId()).orElse(null);
            if (locked != null && locked.isPending()) { // they asked first: mutual consent
                makeFriends(locked, now);
                return;
            }
        }
        if (!requests.findDeclinedSince(me, target, now.minus(DECLINE_COOLDOWN)).isEmpty()) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "FRIEND_REQUEST_COOLDOWN", "You cannot send this person a request right now.");
        }
        if (requests.countByRequesterIdAndCreatedAtAfter(me, now.minus(Duration.ofDays(1))) >= MAX_REQUESTS_PER_DAY) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "FRIEND_REQUEST_LIMIT", "You have sent a lot of requests today. Please try again tomorrow.");
        }
        requireRoom(me);
        try {
            requests.saveAndFlush(new FriendRequest(UUID.randomUUID(), me, target, now));
        } catch (DataIntegrityViolationException e) {
            return; // a concurrent identical request won
        }
        changed(me, target);
    }

    @Transactional
    public void accept(UUID me, UUID requestId) {
        FriendRequest r = requests.findByIdForUpdate(requestId).filter(x -> x.getTargetId().equals(me))
                .orElseThrow(() -> ApiException.notFound("REQUEST_NOT_FOUND", "That request does not exist."));
        if (!r.isPending()) throw ApiException.conflict("REQUEST_CLOSED", "That request is no longer open.");
        if (moderation.isBlockedEitherWay(me, r.getRequesterId()) || !isActive(r.getRequesterId())) {
            throw ApiException.notFound("REQUEST_NOT_FOUND", "That request does not exist.");
        }
        requireRoom(me);
        makeFriends(r, clock.instant());
    }

    /** A declined request is simply closed. It has no effect on random matching, and the requester is not told which way it went. */
    @Transactional
    public void decline(UUID me, UUID requestId) {
        FriendRequest r = requests.findByIdForUpdate(requestId).filter(x -> x.getTargetId().equals(me)).orElse(null);
        if (r == null || !r.isPending()) return;
        r.close(FriendRequestStatus.DECLINED, clock.instant());
        changed(me, r.getRequesterId());
    }

    @Transactional
    public void cancel(UUID me, UUID requestId) {
        FriendRequest r = requests.findByIdForUpdate(requestId).filter(x -> x.getRequesterId().equals(me)).orElse(null);
        if (r == null || !r.isPending()) return;
        r.close(FriendRequestStatus.CANCELLED, clock.instant());
        changed(me, r.getTargetId());
    }

    // ---------------------------------------------------------------- ending a friendship

    /** Removes a friend. Their conversation goes with the friendship; random matching is unaffected. */
    @Transactional
    public void remove(UUID me, String friendRef) {
        UUID other = resolveAnyFriend(me, friendRef).orElseThrow(() -> ApiException.notFound("FRIEND_NOT_FOUND", "That person is not your friend."));
        endFriendship(me, other, true);
    }

    @Transactional
    public void block(UUID me, String friendRef) {
        UUID other = resolveAnyFriend(me, friendRef).orElseThrow(() -> ApiException.notFound("FRIEND_NOT_FOUND", "That person is not your friend."));
        moderation.blockUser(me, other); // publishes UserBlockedEvent, which ends the friendship below
    }

    @Transactional
    public void report(UUID me, String friendRef, ModerationService.ReportRequest req) {
        UUID other = resolveAnyFriend(me, friendRef).orElseThrow(() -> ApiException.notFound("FRIEND_NOT_FOUND", "That person is not your friend."));
        moderation.reportUser(me, other, req);
    }

    /** Blocking in either direction ends the friendship and every open request between the two at once. */
    @EventListener
    void onBlocked(UserBlockedEvent event) {
        UUID a = event.blockerId(), b = event.blockedId();
        Instant now = clock.instant();
        for (FriendRequest open : requests.findPendingBetween(a, b)) {
            requests.findByIdForUpdate(open.getId()).filter(FriendRequest::isPending).ifPresent(r -> r.close(FriendRequestStatus.CANCELLED, now));
        }
        // Messages stay on record only until the periodic purge, so a report can still be reviewed; nobody can read them meanwhile.
        endFriendship(a, b, false);
    }

    @EventListener
    void onAccountDeleted(AccountService.AccountDeletedEvent event) {
        UUID id = event.userId();
        List<UUID> others = friendships.findAllFor(id).stream().map(f -> f.getId().other(id)).toList();
        messages.deleteAllFor(id);
        states.deleteAllFor(id);
        requests.deleteAllFor(id);
        friendships.deleteAllFor(id);
        others.forEach(o -> notifyChanged(o));
    }

    // ---------------------------------------------------------------- internals

    private void endFriendship(UUID a, UUID b, boolean deleteMessages) {
        Friendship.Key key = Friendship.Key.of(a, b);
        if (!friendships.existsById(key)) return;
        friendships.deleteById(key);
        if (deleteMessages) {
            messages.deletePair(key.userA(), key.userB());
            states.deleteById(new ConversationState.Key(a, b));
            states.deleteById(new ConversationState.Key(b, a));
        }
        log.info("friendship-ended users={} {}", a.toString().substring(0, 8), b.toString().substring(0, 8));
        events.publishEvent(new FriendshipEndedEvent(a, b));
        changed(a, b);
    }

    private void makeFriends(FriendRequest r, Instant now) {
        r.close(FriendRequestStatus.ACCEPTED, now);
        Friendship.Key key = Friendship.Key.of(r.getRequesterId(), r.getTargetId());
        // Whole microseconds, like every message timestamp: the database keeps microseconds, so a longer value would be rounded and could
        // end up later than a message sent in the same instant, which would then be hidden by the "after the friendship began" rule.
        if (!friendships.existsById(key)) friendships.save(new Friendship(r.getRequesterId(), r.getTargetId(), now.truncatedTo(java.time.temporal.ChronoUnit.MICROS)));
        changed(r.getRequesterId(), r.getTargetId());
    }

    private void requireRoom(UUID user) {
        if (friendships.findAllFor(user).size() >= MAX_FRIENDS) {
            throw ApiException.conflict("FRIEND_LIMIT", "You have reached the limit of " + MAX_FRIENDS + " friends.");
        }
    }

    private RequestSummary summary(FriendRequest r, PartnerService.PartnerView v) {
        return new RequestSummary(r.getId(), v.displayName(), v.englishLevel(), v.country(), r.getCreatedAt());
    }

    /** Unread messages from a friend and the time of the newest message the viewer can see (null when there is none). */
    private record Activity(long unread, Instant last) {
        static final Activity NONE = new Activity(0, null);
    }

    private Map<UUID, Activity> activityWithFriends(UUID me) {
        Map<UUID, Activity> out = new HashMap<>();
        for (Object[] row : messages.activityWithFriends(me)) {
            out.put((UUID) row[0], new Activity(((Number) row[1]).longValue(), toInstant(row[2])));
        }
        return out;
    }

    /** A native query returns whichever date type the driver maps timestamptz to. */
    private static Instant toInstant(Object value) {
        if (value == null) return null;
        if (value instanceof Instant i) return i;
        if (value instanceof java.time.OffsetDateTime o) return o.toInstant();
        if (value instanceof java.sql.Timestamp t) return t.toInstant();
        throw new IllegalStateException("Unexpected timestamp type " + value.getClass().getName());
    }

    private boolean isActive(UUID id) { return users.findById(id).map(u -> u.getStatus() == UserStatus.ACTIVE).orElse(false); }

    private ApiException notAPartner() { return ApiException.notFound("PARTNER_NOT_FOUND", "That person is not in your previous partners."); }

    private void changed(UUID a, UUID b) {
        AfterCommit.run(() -> {
            notifyChanged(a);
            notifyChanged(b);
        });
    }

    private void notifyChanged(UUID user) { registry.send(user, Map.of("type", "friends.changed")); }

    static Instant floor(ConversationState st, Friendship f) {
        Instant since = f.getCreatedAt();
        return st == null ? since : max(since, st.visibleAfter());
    }

    static Instant max(Instant a, Instant b) { return a.isAfter(b) ? a : b; }

    /** Messages of pairs that are no longer friends are removed after 30 days (they were already unreadable). */
    @org.springframework.scheduling.annotation.Scheduled(cron = "0 17 3 * * *")
    @Transactional
    public void purgeOrphanedMessages() {
        int removed = messages.deleteOrphansBefore(clock.instant().minus(Duration.ofDays(30)));
        if (removed > 0) log.info("purged {} messages of ended friendships", removed);
    }
}
