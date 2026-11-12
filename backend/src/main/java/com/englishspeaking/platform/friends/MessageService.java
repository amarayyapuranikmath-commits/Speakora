package com.englishspeaking.platform.friends;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.partners.PartnerRefs;
import com.englishspeaking.platform.security.RateLimiter;
import com.englishspeaking.platform.websocket.SessionRegistry;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Private messages. Only accepted friends can exchange them, and only while neither has blocked the other; every operation
 * re-checks that on the server. Message text is never written to logs.
 */
@Service
public class MessageService {
    public static final int MAX_LENGTH = 2000;
    public static final int PAGE_SIZE = 40;
    public static final int MESSAGES_PER_MINUTE = 30;

    public record MessageView(UUID id, boolean mine, String body, Instant createdAt) {}

    public record Page(List<MessageView> messages, boolean hasMore) {}

    private final FriendService friends;
    private final FriendshipRepository friendships;
    private final DirectMessageRepository messages;
    private final ConversationStateRepository states;
    private final PartnerRefs refs;
    private final SessionRegistry registry;
    private final RateLimiter limiter;
    private final Clock clock;

    public MessageService(FriendService friends, FriendshipRepository friendships, DirectMessageRepository messages,
                          ConversationStateRepository states, PartnerRefs refs, SessionRegistry registry, RateLimiter limiter, Clock clock) {
        this.friends = friends;
        this.friendships = friendships;
        this.messages = messages;
        this.states = states;
        this.refs = refs;
        this.registry = registry;
        this.limiter = limiter;
        this.clock = clock;
    }

    @Transactional
    public MessageView send(UUID me, String friendRef, String text) {
        UUID other = friend(me, friendRef);
        String body = text == null ? "" : text.strip();
        if (body.isEmpty()) throw ApiException.badRequest("EMPTY_MESSAGE", "Write a message first.");
        if (body.length() > MAX_LENGTH) throw ApiException.badRequest("MESSAGE_TOO_LONG", "Messages can be up to " + MAX_LENGTH + " characters.");
        if (!limiter.tryAcquire("dm:" + me, MESSAGES_PER_MINUTE, Duration.ofMinutes(1))) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "MESSAGE_RATE", "You are sending messages very quickly. Please wait a moment.");
        }
        Friendship.Key pair = Friendship.Key.of(me, other);
        // The database keeps microseconds; two messages in the same clock tick must still keep their order.
        Instant at = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        Instant last = messages.lastAt(pair.userA(), pair.userB(), Instant.EPOCH);
        if (last != null && !at.isAfter(last)) at = last.plus(1, java.time.temporal.ChronoUnit.MICROS);
        // A message must be visible to both people. Messages at or before the moment the friendship began, or before either person's
        // "delete for me", are hidden, so a message sent in the very same clock tick as one of those moments is moved just after it
        // (found by a stress test: the first message after accepting a request vanished about half the time when sent immediately).
        Instant hiddenUpTo = latest(floorFor(me, other, pair), floorFor(other, me, pair));
        if (!at.isAfter(hiddenUpTo)) at = hiddenUpTo.truncatedTo(java.time.temporal.ChronoUnit.MICROS).plus(2, java.time.temporal.ChronoUnit.MICROS);
        DirectMessage saved = messages.save(new DirectMessage(UUID.randomUUID(), me, other, body, at));
        MessageView forRecipient = new MessageView(saved.getId(), false, saved.getBody(), saved.getCreatedAt());
        AfterCommit.run(() -> {
            Map<String, Object> push = new LinkedHashMap<>();
            push.put("type", "message.new");
            push.put("friendRef", refs.friendRef(other, me));
            push.put("message", forRecipient);
            registry.send(other, push);
        });
        return new MessageView(saved.getId(), true, saved.getBody(), saved.getCreatedAt());
    }

    /** Newest {@link #PAGE_SIZE} messages (older ones when {@code before} is given), returned oldest first. */
    @Transactional(readOnly = true)
    public Page list(UUID me, String friendRef, Instant before) {
        UUID other = friend(me, friendRef);
        Friendship.Key key = Friendship.Key.of(me, other);
        Instant floor = floorFor(me, other, key);
        PageRequest page = PageRequest.of(0, PAGE_SIZE + 1);
        List<DirectMessage> rows = before == null
                ? messages.latest(key.userA(), key.userB(), floor, page)
                : messages.older(key.userA(), key.userB(), floor, before, page);
        boolean more = rows.size() > PAGE_SIZE;
        List<MessageView> out = new ArrayList<>();
        for (DirectMessage m : rows.subList(0, Math.min(rows.size(), PAGE_SIZE))) {
            out.add(new MessageView(m.getId(), m.getSenderId().equals(me), m.getBody(), m.getCreatedAt()));
        }
        Collections.reverse(out);
        return new Page(out, more);
    }

    @Transactional
    public void markRead(UUID me, String friendRef) {
        UUID other = friend(me, friendRef);
        ConversationState st = states.findById(new ConversationState.Key(me, other)).orElseGet(() -> new ConversationState(me, other));
        st.setLastReadAt(clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS));
        states.save(st);
    }

    /** "Delete for me": hides the conversation so far from this person only. The friend still has their own copy. */
    @Transactional
    public void clear(UUID me, String friendRef) {
        UUID other = friend(me, friendRef);
        ConversationState st = states.findById(new ConversationState.Key(me, other)).orElseGet(() -> new ConversationState(me, other));
        // Everything so far, including a message whose timestamp was nudged a few microseconds past the clock (see send()).
        Instant now = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        Friendship.Key pair = Friendship.Key.of(me, other);
        Instant last = messages.lastAt(pair.userA(), pair.userB(), Instant.EPOCH);
        st.setClearedAt(last != null && last.isAfter(now) ? last : now);
        states.save(st);
    }

    private static Instant latest(Instant a, Instant b) { return a.isAfter(b) ? a : b; }

    private Instant floorFor(UUID me, UUID other, Friendship.Key key) {
        Friendship f = friendships.findById(key).orElseThrow(this::notFriends);
        ConversationState st = states.findById(new ConversationState.Key(me, other)).orElse(null);
        return FriendService.floor(st, f);
    }

    private UUID friend(UUID me, String friendRef) {
        return friends.resolveFriend(me, friendRef).orElseThrow(this::notFriends);
    }

    private ApiException notFriends() { return ApiException.notFound("FRIEND_NOT_FOUND", "Only friends can message each other."); }
}
