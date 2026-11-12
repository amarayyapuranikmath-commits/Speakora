package com.englishspeaking.platform;

import com.englishspeaking.platform.calling.*;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.friends.Friendship;
import com.englishspeaking.platform.friends.FriendshipRepository;
import com.englishspeaking.platform.matching.MatchmakingStore;
import com.englishspeaking.platform.moderation.UserBlockedEvent;
import com.englishspeaking.platform.partners.*;
import com.englishspeaking.platform.preferences.UserPreferences;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.EnglishLevel;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import com.englishspeaking.platform.user.UserStatus;
import com.englishspeaking.platform.websocket.SessionRegistry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Previous partners, friend status and private-call requests against the real PostgreSQL test database (real queries, real migration V5, real
 * services). Sockets are fakes that record what the server pushes; Redis is replaced by a mock store. Every test rolls back.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Transactional
class PartnerFlowIntegrationTest {
    private static final String URL = "jdbc:postgresql://localhost:5432/english_speaking_test";
    private static String password;

    @BeforeAll
    static void requireTestDatabase() {
        try {
            Matcher m = Pattern.compile("(?m)^DB_PASSWORD=([^\\r\\n]*)$").matcher(Files.readString(Path.of("../.env")));
            Assumptions.assumeTrue(m.find(), "no DB_PASSWORD in ../.env");
            password = m.group(1).trim();
            try (var c = DriverManager.getConnection(URL, "esp_app", password)) { c.isValid(2); }
        } catch (Exception e) {
            Assumptions.abort("PostgreSQL test database not reachable: " + e.getClass().getSimpleName());
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> URL);
        registry.add("spring.datasource.username", () -> "esp_app");
        registry.add("spring.datasource.password", () -> password);
    }

    @MockitoBean MatchmakingStore store;
    @Autowired UserRepository users;
    @Autowired UserProfileRepository profiles;
    @Autowired UserPreferencesRepository preferences;
    @Autowired CallSessionRepository sessions;
    @Autowired CallParticipantRepository participants;
    @Autowired CallService calls;
    @Autowired PartnerService partners;
    @Autowired ConnectionRequestService connections;
    @Autowired PartnerRequestRepository requests;
    @Autowired SessionRegistry registry;
    @Autowired FriendshipRepository friendships;
    @Autowired PartnerRefs partnerRefs;
    @Autowired ApplicationEventPublisher events;
    @Autowired com.englishspeaking.platform.moderation.UserBlockRepository blocks;
    private final ObjectMapper mapper = new ObjectMapper();

    /** A fake websocket that remembers every message the server sent to it. */
    private static final class Socket {
        final List<JsonNode> received = new ArrayList<>();
        final WebSocketSession session = mock(WebSocketSession.class);

        Socket(ObjectMapper mapper) throws Exception {
            when(session.isOpen()).thenReturn(true);
            org.mockito.Mockito.doAnswer(i -> {
                received.add(mapper.readTree(((TextMessage) i.getArgument(0)).getPayload()));
                return null;
            }).when(session).sendMessage(any());
        }

        List<JsonNode> of(String type) { return received.stream().filter(m -> type.equals(m.get("type").asText())).toList(); }
        JsonNode last(String type) { var l = of(type); return l.isEmpty() ? null : l.get(l.size() - 1); }
        void clear() { received.clear(); }
    }

    private final java.util.Map<UUID, Socket> sockets = new java.util.HashMap<>();

    @BeforeEach
    void storeDefaults() {
        when(store.claimDirect(any(), any(), any())).thenReturn(true);
        when(store.activeCall(any())).thenReturn(Optional.empty());
    }

    private User person(String name) {
        User u = new User(name.toLowerCase() + "." + UUID.randomUUID() + "@it.example.com", "hash", LocalDate.of(1990, 1, 1));
        u.setOnboardingCompleted(true);
        users.saveAndFlush(u);
        UserProfile p = new UserProfile(u.getId(), name);
        p.setEnglishLevel(EnglishLevel.B2);
        p.setCountry("GB");
        profiles.saveAndFlush(p);
        preferences.saveAndFlush(new UserPreferences(u.getId()));
        return u;
    }

    private Socket online(User u) throws Exception {
        Socket s = new Socket(mapper);
        registry.register(u.getId(), s.session);
        sockets.put(u.getId(), s);
        return s;
    }

    /** A finished, connected call of the given length: this is what makes two people previous partners. */
    private UUID talked(User a, User b, int seconds) {
        UUID id = UUID.randomUUID();
        Instant start = Instant.now().minusSeconds(3600);
        CallSession c = new CallSession(id, null, start);
        c.transitionTo(CallStatus.CONNECTING);
        c.markConnected(start.plusSeconds(2));
        c.finish(CallStatus.COMPLETED, EndReason.ENDED, start.plusSeconds(2 + seconds));
        sessions.saveAndFlush(c);
        participants.saveAllAndFlush(List.of(new CallParticipant(id, a.getId()), new CallParticipant(id, b.getId())));
        return id;
    }

    /** Makes the two accepted friends (if they are not yet) and returns the handle the viewer uses for a private call. */
    private String friendRef(User viewer, User friend) {
        Friendship.Key key = Friendship.Key.of(viewer.getId(), friend.getId());
        if (!friendships.existsById(key)) friendships.saveAndFlush(new Friendship(viewer.getId(), friend.getId(), Instant.now().minusSeconds(3600)));
        return partnerRefs.friendRef(viewer.getId(), friend.getId());
    }

    private String refOf(User viewer, User partner) {
        return partners.list(viewer.getId()).stream().filter(p -> p.displayName().equals(profiles.findById(partner.getId()).orElseThrow().getDisplayName()))
                .findFirst().orElseThrow().ref();
    }

    // ------------------------------------------------------------------ the partner list

    @Test
    void onlyPeopleYouReallyTalkedToAppearWithCountAndLastDate() throws Exception {
        User me = person("Me"), real = person("Real"), brief = person("Brief"), stranger = person("Stranger");
        talked(me, real, 120);
        talked(me, real, 300);
        talked(me, brief, 5); // too short to count as a conversation
        CallSession cancelled = new CallSession(UUID.randomUUID(), null, Instant.now().minusSeconds(600));
        cancelled.finish(CallStatus.CANCELLED, EndReason.ENDED, Instant.now().minusSeconds(590));
        sessions.saveAndFlush(cancelled);
        participants.saveAllAndFlush(List.of(new CallParticipant(cancelled.getId(), me.getId()), new CallParticipant(cancelled.getId(), stranger.getId())));

        var list = partners.list(me.getId());

        assertThat(list).extracting(PartnerService.PartnerSummary::displayName).containsExactly("Real");
        var p = list.get(0);
        assertThat(p.conversations()).isEqualTo(2);
        assertThat(p.lastConversationAt()).isNotNull();
        assertThat(p.lastCallId()).isNotNull();
        assertThat(p.englishLevel()).isEqualTo(EnglishLevel.B2);
        assertThat(p.country()).isEqualTo("GB");
        assertThat(p.ref()).isNotBlank().doesNotContain(real.getId().toString());
        assertThat(partners.list(real.getId())).extracting(PartnerService.PartnerSummary::displayName).containsExactly("Me"); // it is mutual
    }

    @Test
    void friendStatusShowsWhereEachPersonStands() throws Exception {
        User me = person("Me"), a = person("Anna"), b = person("Ben"), c = person("Cleo"), d = person("Dan");
        talked(me, a, 60); talked(me, b, 60); talked(me, c, 60); talked(me, d, 60);
        friendRef(me, a);
        requests.flush();
        com.englishspeaking.platform.friends.FriendRequestRepository fr = friendRequests;
        fr.saveAndFlush(new com.englishspeaking.platform.friends.FriendRequest(UUID.randomUUID(), me.getId(), b.getId(), Instant.now()));
        fr.saveAndFlush(new com.englishspeaking.platform.friends.FriendRequest(UUID.randomUUID(), c.getId(), me.getId(), Instant.now()));

        assertThat(statusOf(me, "Anna")).isEqualTo(PartnerService.FriendStatus.FRIENDS);
        assertThat(statusOf(me, "Ben")).isEqualTo(PartnerService.FriendStatus.REQUEST_SENT);
        assertThat(statusOf(me, "Cleo")).isEqualTo(PartnerService.FriendStatus.REQUEST_RECEIVED);
        assertThat(statusOf(me, "Dan")).isEqualTo(PartnerService.FriendStatus.NONE);
        assertThat(partners.list(me.getId()).stream().filter(p -> p.displayName().equals("Dan")).findFirst().orElseThrow().canAddFriend()).isTrue();
        assertThat(partners.list(me.getId()).stream().filter(p -> p.displayName().equals("Anna")).findFirst().orElseThrow().canAddFriend()).isFalse();
    }

    @Autowired com.englishspeaking.platform.friends.FriendRequestRepository friendRequests;

    private PartnerService.FriendStatus statusOf(User viewer, String name) {
        return partners.list(viewer.getId()).stream().filter(p -> p.displayName().equals(name)).findFirst().orElseThrow().friendStatus();
    }

    @Test
    void privateCallsDoNotCountAsPreviousPartners() throws Exception {
        User me = person("Me"), p = person("Pat");
        UUID id = UUID.randomUUID();
        Instant start = Instant.now().minusSeconds(3600);
        CallSession c = new CallSession(id, null, start, CallKind.PRIVATE);
        c.transitionTo(CallStatus.CONNECTING);
        c.markConnected(start.plusSeconds(2));
        c.finish(CallStatus.COMPLETED, EndReason.ENDED, start.plusSeconds(200));
        sessions.saveAndFlush(c);
        participants.saveAllAndFlush(List.of(new CallParticipant(id, me.getId()), new CallParticipant(id, p.getId())));

        assertThat(partners.list(me.getId())).isEmpty();
    }

    @Test
    void blockedSuspendedAndHiddenDetailsAreRespected() throws Exception {
        User me = person("Me"), blocked = person("Blocked"), gone = person("Gone"), shy = person("Shy");
        talked(me, blocked, 60); talked(me, gone, 60); talked(me, shy, 60);
        blocks.saveAndFlush(new com.englishspeaking.platform.moderation.UserBlock(me.getId(), blocked.getId()));
        User g = users.findById(gone.getId()).orElseThrow();
        g.setStatus(UserStatus.SUSPENDED);
        users.saveAndFlush(g);
        UserPreferences sp = preferences.findById(shy.getId()).orElseThrow();
        sp.setShowLevel(false);
        sp.setShowCountry(false);
        preferences.saveAndFlush(sp);

        var list = partners.list(me.getId());

        assertThat(list).extracting(PartnerService.PartnerSummary::displayName).containsExactly("Shy");
        assertThat(list.get(0).englishLevel()).isNull();
        assertThat(list.get(0).country()).isNull();
        // And the other direction: the person who was blocked no longer sees the blocker either.
        assertThat(partners.list(blocked.getId())).isEmpty();
    }

    @Test
    void refsAreOnlyValidForTheirOwnerAndOnlyForRealPartners() throws Exception {
        User me = person("Me"), p = person("Pat"), other = person("Other");
        talked(me, p, 60);
        talked(other, p, 60);
        String ref = refOf(me, p);

        assertThat(partners.resolve(me.getId(), ref)).contains(p.getId());
        assertThat(partners.resolve(other.getId(), ref)).as("someone else's handle").isEmpty();
        assertThat(partners.resolve(me.getId(), "nonsense")).isEmpty();
        assertThat(partners.resolve(me.getId(), null)).isEmpty();
    }

    // ------------------------------------------------------------------ call-again requests

    @Test
    void aRequestNotifiesTheOtherPersonInRealTimeAndWaitsForTheirAnswer() throws Exception {
        User me = person("Me"), p = person("Pat");
        talked(me, p, 60);
        Socket mine = online(me), theirs = online(p);

        connections.request(me.getId(), friendRef(me, p));

        JsonNode incoming = theirs.last("connect.request");
        assertThat(incoming).as("the other person is asked").isNotNull();
        assertThat(incoming.get("from").get("displayName").asText()).isEqualTo("Me");
        assertThat(incoming.toString()).doesNotContain(me.getId().toString()).doesNotContain("@");
        JsonNode ringing = mine.last("connect.ringing");
        assertThat(ringing.get("partner").get("displayName").asText()).isEqualTo("Pat");
        assertThat(ringing.get("requestId").asText()).isEqualTo(incoming.get("requestId").asText());
        // Nobody has been put in a call without agreeing.
        assertThat(calls.activeCallOf(me.getId())).isEmpty();
        assertThat(calls.activeCallOf(p.getId())).isEmpty();
        verifyNoDirectClaim();
    }

    private void verifyNoDirectClaim() {
        org.mockito.Mockito.verify(store, org.mockito.Mockito.never()).claimDirect(any(), any(), any());
    }

    @Test
    void acceptingCreatesTheCallForBoth() throws Exception {
        User me = person("Me"), p = person("Pat");
        talked(me, p, 60);
        online(me);
        Socket theirs = online(p);
        connections.request(me.getId(), friendRef(me, p));
        UUID requestId = UUID.fromString(theirs.last("connect.request").get("requestId").asText());

        connections.accept(p.getId(), requestId);

        PartnerRequest r = requests.findById(requestId).orElseThrow();
        assertThat(r.getStatus()).isEqualTo(PartnerRequestStatus.ACCEPTED);
        assertThat(r.getCallId()).isNotNull();
        assertThat(sessions.findById(r.getCallId()).orElseThrow().getKind()).isEqualTo(CallKind.PRIVATE);
        assertThat(calls.activeCallOf(me.getId())).isPresent().get().extracting(CallSession::getId).isEqualTo(r.getCallId());
        assertThat(calls.activeCallOf(p.getId())).isPresent();
        org.mockito.Mockito.verify(store).claimDirect(me.getId(), p.getId(), r.getCallId());
        // The request cannot be accepted a second time (no duplicate call).
        assertThatThrownBy(() -> connections.accept(p.getId(), requestId)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("REQUEST_CLOSED"));
    }

    @Test
    void decliningTellsTheRequesterAndStartsACooldown() throws Exception {
        User me = person("Me"), p = person("Pat");
        talked(me, p, 60);
        Socket mine = online(me), theirs = online(p);
        connections.request(me.getId(), friendRef(me, p));
        UUID requestId = UUID.fromString(theirs.last("connect.request").get("requestId").asText());

        connections.decline(p.getId(), requestId);

        assertThat(mine.last("connect.status").get("status").asText()).isEqualTo("DECLINED");
        assertThat(requests.findById(requestId).orElseThrow().getStatus()).isEqualTo(PartnerRequestStatus.DECLINED);
        assertThat(calls.activeCallOf(me.getId())).isEmpty();
        assertThatThrownBy(() -> connections.request(me.getId(), friendRef(me, p)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("REQUEST_COOLDOWN"));
    }

    @Test
    void anOfflineBusyOrOptedOutPersonIsReportedClearlyAndNothingIsSent() throws Exception {
        User me = person("Me"), off = person("Off"), busy = person("Busy"), quiet = person("Quiet");
        talked(me, off, 60); talked(me, busy, 60); talked(me, quiet, 60);
        Socket mine = online(me);
        Socket busySocket = online(busy);
        online(quiet);
        CallSession live = new CallSession(UUID.randomUUID(), null, Instant.now());
        sessions.saveAndFlush(live);
        participants.saveAllAndFlush(List.of(new CallParticipant(live.getId(), busy.getId()), new CallParticipant(live.getId(), person("Other").getId())));
        UserPreferences qp = preferences.findById(quiet.getId()).orElseThrow();
        qp.setAllowPartnerRequests(false);
        preferences.saveAndFlush(qp);

        connections.request(me.getId(), friendRef(me, off));
        assertThat(mine.last("connect.status").get("reason").asText()).isEqualTo("OFFLINE");
        connections.request(me.getId(), friendRef(me, busy));
        assertThat(mine.last("connect.status").get("reason").asText()).isEqualTo("BUSY");
        connections.request(me.getId(), friendRef(me, quiet));
        assertThat(mine.last("connect.status").get("reason").asText()).isEqualTo("NOT_ACCEPTING");

        assertThat(busySocket.of("connect.request")).isEmpty();
        assertThat(requests.count()).isZero();
    }

    @Test
    void onlyAcceptedFriendsCanBeCalledPrivately() throws Exception {
        User me = person("Me"), met = person("Met"), blocked = person("Blocked"), other = person("Other"), othersFriend = person("OthersFriend");
        talked(me, met, 60); // a previous partner is NOT a friend
        online(me); online(met); online(blocked); online(othersFriend);

        assertThatThrownBy(() -> connections.request(me.getId(), refOf(me, met))).as("a previous partner's handle").isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("FRIEND_NOT_FOUND"));
        assertThatThrownBy(() -> connections.request(me.getId(), "not-a-real-ref")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("FRIEND_NOT_FOUND"));
        String theirHandle = friendRef(other, othersFriend); // somebody else's friend handle does not work for me
        assertThatThrownBy(() -> connections.request(me.getId(), theirHandle)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("FRIEND_NOT_FOUND"));

        String blockedRef = friendRef(me, blocked);
        blocks.saveAndFlush(new com.englishspeaking.platform.moderation.UserBlock(blocked.getId(), me.getId())); // THEY blocked me
        assertThatThrownBy(() -> connections.request(me.getId(), blockedRef)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("FRIEND_NOT_FOUND"));
        assertThat(requests.count()).isZero();
    }

    @Test
    void anUnansweredRequestExpiresAndBothSidesAreTold() throws Exception {
        User me = person("Me"), p = person("Pat");
        talked(me, p, 60);
        Socket mine = online(me), theirs = online(p);
        PartnerRequest old = requests.saveAndFlush(new PartnerRequest(UUID.randomUUID(), me.getId(), p.getId(), Instant.now().minusSeconds(60), Instant.now().minusSeconds(15)));

        connections.expireOld();

        assertThat(requests.findById(old.getId()).orElseThrow().getStatus()).isEqualTo(PartnerRequestStatus.EXPIRED);
        assertThat(mine.last("connect.status").get("status").asText()).isEqualTo("EXPIRED");
        assertThat(theirs.last("connect.closed").get("reason").asText()).isEqualTo("EXPIRED");
    }

    @Test
    void anExpiredRequestCannotBeAccepted() throws Exception {
        User me = person("Me"), p = person("Pat");
        talked(me, p, 60);
        Socket mine = online(me);
        online(p);
        PartnerRequest old = requests.saveAndFlush(new PartnerRequest(UUID.randomUUID(), me.getId(), p.getId(), Instant.now().minusSeconds(60), Instant.now().minusSeconds(1)));

        connections.accept(p.getId(), old.getId());

        assertThat(requests.findById(old.getId()).orElseThrow().getStatus()).isEqualTo(PartnerRequestStatus.EXPIRED);
        assertThat(calls.activeCallOf(me.getId())).isEmpty();
        assertThat(mine.last("connect.status").get("status").asText()).isEqualTo("EXPIRED");
    }

    @Test
    void onlyTheTargetCanAnswerAndOnlyTheRequesterCanWithdraw() throws Exception {
        User me = person("Me"), p = person("Pat"), intruder = person("Intruder");
        talked(me, p, 60);
        online(me); Socket theirs = online(p); online(intruder);
        connections.request(me.getId(), friendRef(me, p));
        UUID requestId = UUID.fromString(theirs.last("connect.request").get("requestId").asText());

        assertThatThrownBy(() -> connections.accept(intruder.getId(), requestId)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("REQUEST_NOT_FOUND"));
        assertThatThrownBy(() -> connections.accept(me.getId(), requestId)).as("the requester cannot accept their own request")
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("REQUEST_NOT_FOUND"));
        connections.cancel(intruder.getId(), requestId);
        connections.decline(intruder.getId(), requestId);
        assertThat(requests.findById(requestId).orElseThrow().getStatus()).isEqualTo(PartnerRequestStatus.PENDING);

        connections.cancel(me.getId(), requestId);
        assertThat(requests.findById(requestId).orElseThrow().getStatus()).isEqualTo(PartnerRequestStatus.CANCELLED);
        assertThat(theirs.last("connect.closed").get("reason").asText()).isEqualTo("CANCELLED");
    }

    @Test
    void whenBothAskEachOtherTheyAreConnectedAtOnce() throws Exception {
        User me = person("Me"), p = person("Pat");
        talked(me, p, 60);
        online(me); online(p);
        connections.request(me.getId(), friendRef(me, p));

        connections.request(p.getId(), friendRef(p, me));

        assertThat(calls.activeCallOf(me.getId())).isPresent();
        assertThat(calls.activeCallOf(p.getId())).isPresent();
        assertThat(requests.findAll()).hasSize(1).first().extracting(PartnerRequest::getStatus).isEqualTo(PartnerRequestStatus.ACCEPTED);
    }

    @Test
    void askingTwiceDoesNotDuplicateAndAskingSomeoneElseWithdrawsTheFirst() throws Exception {
        User me = person("Me"), a = person("Anna"), b = person("Ben");
        talked(me, a, 60); talked(me, b, 60);
        online(me); Socket annaSocket = online(a); online(b);

        connections.request(me.getId(), friendRef(me, a));
        connections.request(me.getId(), friendRef(me, a));
        assertThat(requests.count()).isEqualTo(1);

        connections.request(me.getId(), friendRef(me, b));
        assertThat(requests.findByRequesterIdAndStatus(me.getId(), PartnerRequestStatus.PENDING)).hasSize(1);
        assertThat(annaSocket.last("connect.closed").get("reason").asText()).isEqualTo("CANCELLED");
    }

    @Test
    void goingOfflineWithdrawsTheRequestsAndTellsTheOtherSide() throws Exception {
        User me = person("Me"), p = person("Pat");
        talked(me, p, 60);
        Socket mine = online(me), theirs = online(p);
        connections.request(me.getId(), friendRef(me, p));

        connections.onDisconnect(me.getId()); // the requester vanished
        assertThat(theirs.last("connect.closed").get("reason").asText()).isEqualTo("CANCELLED");

        mine.clear();
        connections.request(me.getId(), friendRef(me, p));
        connections.onDisconnect(p.getId()); // the person being asked vanished
        assertThat(mine.last("connect.status").get("reason").asText()).isEqualTo("OFFLINE");
        assertThat(requests.findByTargetIdAndStatus(p.getId(), PartnerRequestStatus.PENDING)).isEmpty();
    }

    @Test
    void blockingWithdrawsAnOpenRequestWithoutRevealingTheBlock() throws Exception {
        User me = person("Me"), p = person("Pat");
        talked(me, p, 60);
        Socket mine = online(me), theirs = online(p);
        connections.request(me.getId(), friendRef(me, p));

        events.publishEvent(new UserBlockedEvent(p.getId(), me.getId())); // Pat blocks me

        assertThat(theirs.last("connect.closed")).isNotNull();
        JsonNode status = mine.last("connect.status");
        assertThat(status.get("status").asText()).isEqualTo("UNAVAILABLE");
        assertThat(status.toString()).doesNotContain("BLOCK");
    }

    @Test
    void aFloodOfRequestsIsLimited() throws Exception {
        User me = person("Me");
        online(me);
        for (int i = 0; i < ConnectionRequestService.MAX_REQUESTS_PER_WINDOW; i++) {
            User p = person("P" + i);
            talked(me, p, 60);
            requests.save(new PartnerRequest(UUID.randomUUID(), me.getId(), p.getId(), Instant.now(), Instant.now().plusSeconds(45)));
            requests.flush();
        }
        User extra = person("Extra");
        talked(me, extra, 60);
        online(extra);

        assertThatThrownBy(() -> connections.request(me.getId(), friendRef(me, extra)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("REQUEST_LIMIT"));
    }
}
