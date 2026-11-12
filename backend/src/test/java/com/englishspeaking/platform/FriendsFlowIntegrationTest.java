package com.englishspeaking.platform;

import com.englishspeaking.platform.calling.CallParticipant;
import com.englishspeaking.platform.calling.CallParticipantRepository;
import com.englishspeaking.platform.calling.CallSession;
import com.englishspeaking.platform.calling.CallSessionRepository;
import com.englishspeaking.platform.calling.CallStatus;
import com.englishspeaking.platform.calling.EndReason;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.friends.DirectMessageRepository;
import com.englishspeaking.platform.friends.FriendRequestRepository;
import com.englishspeaking.platform.friends.FriendRequestStatus;
import com.englishspeaking.platform.friends.FriendService;
import com.englishspeaking.platform.friends.FriendshipRepository;
import com.englishspeaking.platform.friends.MessageService;
import com.englishspeaking.platform.matching.MatchmakingStore;
import com.englishspeaking.platform.moderation.ModerationService;
import com.englishspeaking.platform.moderation.ReportReason;
import com.englishspeaking.platform.moderation.UserReportRepository;
import com.englishspeaking.platform.moderation.UserBlockRepository;
import com.englishspeaking.platform.partners.ConnectionRequestService;
import com.englishspeaking.platform.partners.PartnerRefs;
import com.englishspeaking.platform.partners.PartnerService;
import com.englishspeaking.platform.preferences.UserPreferences;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.EnglishLevel;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.user.AccountService;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Propagation;
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
 * Friends, friend requests, private messages and blocking against the real PostgreSQL test database (real V6 migration and
 * queries). Every test rolls back except the one that needs real commits to observe live pushes, which deletes what it created.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Transactional
class FriendsFlowIntegrationTest {
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
        registry.add("spring.jpa.properties.hibernate.generate_statistics", () -> "true"); // lets a test count the statements a request makes
        registry.add("logging.level.org.hibernate.engine.internal.StatisticalLoggingSessionEventListener", () -> "WARN"); // not a line per session
    }

    @MockitoBean MatchmakingStore store;
    @Autowired UserRepository users;
    @Autowired UserProfileRepository profiles;
    @Autowired UserPreferencesRepository preferences;
    @Autowired CallSessionRepository sessions;
    @Autowired CallParticipantRepository participants;
    @Autowired PartnerService partners;
    @Autowired PartnerRefs refs;
    @Autowired FriendService friends;
    @Autowired MessageService messages;
    @Autowired ConnectionRequestService connections;
    @Autowired ModerationService moderation;
    @Autowired FriendRequestRepository requests;
    @Autowired FriendshipRepository friendships;
    @Autowired DirectMessageRepository directMessages;
    @Autowired UserBlockRepository blocks;
    @Autowired UserReportRepository reports;
    @Autowired SessionRegistry registry;
    @Autowired ApplicationEventPublisher events;
    @Autowired JdbcTemplate jdbc;
    @Autowired jakarta.persistence.EntityManagerFactory entityManagerFactory;
    private final ObjectMapper mapper = new ObjectMapper();

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
    }

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
        return s;
    }

    /** A finished random call of the given length: this is what makes two people previous partners. */
    private void talked(User a, User b, int seconds) {
        UUID id = UUID.randomUUID();
        Instant start = Instant.now().minusSeconds(3600);
        CallSession c = new CallSession(id, null, start);
        c.transitionTo(CallStatus.CONNECTING);
        c.markConnected(start.plusSeconds(2));
        c.finish(CallStatus.COMPLETED, EndReason.ENDED, start.plusSeconds(2 + seconds));
        sessions.saveAndFlush(c);
        participants.saveAllAndFlush(List.of(new CallParticipant(id, a.getId()), new CallParticipant(id, b.getId())));
    }

    private String partnerRef(User viewer, String name) {
        return partners.list(viewer.getId()).stream().filter(p -> p.displayName().equals(name)).findFirst().orElseThrow().ref();
    }

    private String friendRef(User viewer, User friend) { return refs.friendRef(viewer.getId(), friend.getId()); }

    /** The two talk, one asks, the other accepts. Goes through the real service methods. */
    private void befriend(User a, String aName, User b) {
        talked(a, b, 60);
        friends.sendRequest(a.getId(), partnerRef(a, profiles.findById(b.getId()).orElseThrow().getDisplayName()));
        UUID id = friends.overview(b.getId()).incoming().get(0).id();
        friends.accept(b.getId(), id);
    }

    private void expect(String code, Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo(code));
    }

    // ------------------------------------------------------------------ requests

    @Test
    void aFriendRequestGoesToAPreviousPartnerAndIsNotAFriendshipUntilAccepted() {
        User me = person("Me"), pat = person("Pat");
        talked(me, pat, 60);

        friends.sendRequest(me.getId(), partnerRef(me, "Pat"));

        FriendService.Overview mine = friends.overview(me.getId()), theirs = friends.overview(pat.getId());
        assertThat(mine.friends()).isEmpty();
        assertThat(mine.outgoing()).extracting(FriendService.RequestSummary::displayName).containsExactly("Pat");
        assertThat(theirs.incoming()).extracting(FriendService.RequestSummary::displayName).containsExactly("Me");
        assertThat(theirs.incoming().get(0).toString()).doesNotContain(me.getId().toString()).doesNotContain("@");
        assertThat(friends.areFriends(me.getId(), pat.getId())).isFalse();
        assertThat(partners.list(me.getId()).get(0).friendStatus()).isEqualTo(PartnerService.FriendStatus.REQUEST_SENT);
        assertThat(partners.list(pat.getId()).get(0).friendStatus()).isEqualTo(PartnerService.FriendStatus.REQUEST_RECEIVED);

        friends.sendRequest(me.getId(), partnerRef(me, "Pat")); // asking again changes nothing
        assertThat(requests.count()).isEqualTo(1);
    }

    @Test
    void onlyPeopleYouTalkedToCanBeAsked() {
        User me = person("Me"), stranger = person("Stranger"), other = person("Other");
        talked(other, stranger, 60);
        String strangersRef = partnerRef(other, "Stranger");

        expect("PARTNER_NOT_FOUND", () -> friends.sendRequest(me.getId(), "nonsense"));
        expect("PARTNER_NOT_FOUND", () -> friends.sendRequest(me.getId(), strangersRef)); // somebody else's handle
        expect("PARTNER_NOT_FOUND", () -> friends.sendRequest(me.getId(), null));
        assertThat(requests.count()).isZero();
    }

    @Test
    void acceptingMakesBothFriendsAndKeepsThemEligibleForRandomMatching() {
        User me = person("Me"), pat = person("Pat");
        talked(me, pat, 60);
        friends.sendRequest(me.getId(), partnerRef(me, "Pat"));

        friends.accept(pat.getId(), friends.overview(pat.getId()).incoming().get(0).id());

        assertThat(friends.areFriends(me.getId(), pat.getId())).isTrue();
        assertThat(friends.overview(me.getId()).friends()).extracting(FriendService.FriendSummary::displayName).containsExactly("Pat");
        assertThat(friends.overview(pat.getId()).friends()).extracting(FriendService.FriendSummary::displayName).containsExactly("Me");
        assertThat(friends.overview(me.getId()).outgoing()).isEmpty();
        assertThat(moderation.excludedPartners(me.getId())).doesNotContain(pat.getId()); // still matchable at random
        expect("ALREADY_FRIENDS", () -> friends.sendRequest(me.getId(), partnerRef(me, "Pat")));
    }

    @Test
    void decliningDoesNotAffectRandomMatchingOrPreviousPartnersAndHasACooldown() {
        User me = person("Me"), pat = person("Pat");
        talked(me, pat, 60);
        friends.sendRequest(me.getId(), partnerRef(me, "Pat"));
        UUID requestId = friends.overview(pat.getId()).incoming().get(0).id();

        friends.decline(pat.getId(), requestId);

        assertThat(requests.findById(requestId).orElseThrow().getStatus()).isEqualTo(FriendRequestStatus.DECLINED);
        assertThat(friends.areFriends(me.getId(), pat.getId())).isFalse();
        assertThat(moderation.excludedPartners(me.getId())).isEmpty();
        assertThat(moderation.excludedPartners(pat.getId())).isEmpty();
        assertThat(partners.list(me.getId())).extracting(PartnerService.PartnerSummary::displayName).containsExactly("Pat");
        assertThat(friends.overview(me.getId()).outgoing()).isEmpty();
        expect("FRIEND_REQUEST_COOLDOWN", () -> friends.sendRequest(me.getId(), partnerRef(me, "Pat")));
        // Pat can still ask me.
        friends.sendRequest(pat.getId(), partnerRef(pat, "Me"));
        assertThat(friends.overview(me.getId()).incoming()).hasSize(1);
    }

    @Test
    void whenBothAskEachOtherTheyBecomeFriendsAtOnce() {
        User me = person("Me"), pat = person("Pat");
        talked(me, pat, 60);
        friends.sendRequest(me.getId(), partnerRef(me, "Pat"));

        friends.sendRequest(pat.getId(), partnerRef(pat, "Me"));

        assertThat(friends.areFriends(me.getId(), pat.getId())).isTrue();
        assertThat(requests.findByTargetIdAndStatus(pat.getId(), FriendRequestStatus.PENDING)).isEmpty();
    }

    @Test
    void onlyTheTargetCanAnswerAndOnlyTheSenderCanWithdraw() {
        User me = person("Me"), pat = person("Pat"), intruder = person("Intruder");
        talked(me, pat, 60);
        friends.sendRequest(me.getId(), partnerRef(me, "Pat"));
        UUID id = friends.overview(pat.getId()).incoming().get(0).id();

        expect("REQUEST_NOT_FOUND", () -> friends.accept(intruder.getId(), id));
        expect("REQUEST_NOT_FOUND", () -> friends.accept(me.getId(), id)); // not the sender either
        friends.cancel(pat.getId(), id);
        friends.decline(intruder.getId(), id);
        assertThat(requests.findById(id).orElseThrow().getStatus()).isEqualTo(FriendRequestStatus.PENDING);

        friends.cancel(me.getId(), id);
        assertThat(requests.findById(id).orElseThrow().getStatus()).isEqualTo(FriendRequestStatus.CANCELLED);
        expect("REQUEST_CLOSED", () -> friends.accept(pat.getId(), id));
    }

    @Test
    void aFloodOfRequestsIsLimited() {
        User me = person("Me");
        for (int i = 0; i < FriendService.MAX_REQUESTS_PER_DAY; i++) {
            User p = person("P" + i);
            talked(me, p, 60);
            friends.sendRequest(me.getId(), partnerRef(me, "P" + i));
        }
        User extra = person("Extra");
        talked(me, extra, 60);

        expect("FRIEND_REQUEST_LIMIT", () -> friends.sendRequest(me.getId(), partnerRef(me, "Extra")));
    }

    // ------------------------------------------------------------------ messages

    /**
     * Regression for a real bug found by stress-testing the (formerly "flaky") test below: a message sent in the same clock tick as the
     * moment the friendship began had a timestamp at or before the friendship's, and the "only messages after the friendship began are
     * shown" rule hid it. About half of 400 immediate repetitions lost the first message before the fix.
     */
    @org.junit.jupiter.api.RepeatedTest(100)
    void aMessageSentImmediatelyAfterBecomingFriendsIsNeverLost() {
        User me = person("Me"), pat = person("Pat");
        befriend(me, "Me", pat);
        messages.send(me.getId(), friendRef(me, pat), "  Hello Pat  ");
        messages.send(pat.getId(), friendRef(pat, me), "Hi!");
        messages.send(me.getId(), friendRef(me, pat), "How are you?");
        var expected = java.util.List.of("Hello Pat", "Hi!", "How are you?");
        assertThat(messages.list(me.getId(), friendRef(me, pat), null).messages()).extracting(MessageService.MessageView::body).containsExactlyElementsOf(expected);
        assertThat(messages.list(pat.getId(), friendRef(pat, me), null).messages()).extracting(MessageService.MessageView::body).containsExactlyElementsOf(expected);
    }

    @org.junit.jupiter.api.RepeatedTest(50)
    void aMessageSentImmediatelyAfterDeleteForMeIsVisibleToBoth() {
        User me = person("Me"), pat = person("Pat");
        befriend(me, "Me", pat);
        messages.send(me.getId(), friendRef(me, pat), "before");
        messages.clear(me.getId(), friendRef(me, pat));
        messages.send(pat.getId(), friendRef(pat, me), "after one");
        messages.clear(pat.getId(), friendRef(pat, me));
        messages.send(me.getId(), friendRef(me, pat), "after two");
        assertThat(messages.list(me.getId(), friendRef(me, pat), null).messages()).extracting(MessageService.MessageView::body).containsExactly("after one", "after two");
        assertThat(messages.list(pat.getId(), friendRef(pat, me), null).messages()).extracting(MessageService.MessageView::body).containsExactly("after two");
    }

    @Test
    void friendsCanMessageAndEachSeesTheirOwnSideAndUnreadCounts() {
        User me = person("Me"), pat = person("Pat");
        befriend(me, "Me", pat);

        messages.send(me.getId(), friendRef(me, pat), "  Hello Pat  ");
        messages.send(pat.getId(), friendRef(pat, me), "Hi!");
        messages.send(me.getId(), friendRef(me, pat), "How are you?");

        var mine = messages.list(me.getId(), friendRef(me, pat), null).messages();
        assertThat(mine).extracting(MessageService.MessageView::body).containsExactly("Hello Pat", "Hi!", "How are you?");
        assertThat(mine).extracting(MessageService.MessageView::mine).containsExactly(true, false, true);
        var theirs = messages.list(pat.getId(), friendRef(pat, me), null).messages();
        assertThat(theirs).extracting(MessageService.MessageView::mine).containsExactly(false, true, false);

        assertThat(friends.overview(pat.getId()).friends().get(0).unread()).isEqualTo(2);
        assertThat(friends.overview(me.getId()).friends().get(0).unread()).isEqualTo(1);
        messages.markRead(pat.getId(), friendRef(pat, me));
        assertThat(friends.overview(pat.getId()).friends().get(0).unread()).isZero();
        assertThat(friends.overview(pat.getId()).friends().get(0).lastMessageAt()).isNotNull();
    }

    @Test
    void messagesAreValidatedAndHistoryIsPaged() {
        User me = person("Me"), pat = person("Pat");
        befriend(me, "Me", pat);
        String ref = friendRef(me, pat);

        expect("EMPTY_MESSAGE", () -> messages.send(me.getId(), ref, "   "));
        expect("EMPTY_MESSAGE", () -> messages.send(me.getId(), ref, null));
        expect("MESSAGE_TOO_LONG", () -> messages.send(me.getId(), ref, "x".repeat(MessageService.MAX_LENGTH + 1)));
        for (int i = 0; i < MessageService.PAGE_SIZE + 5; i++) {
            jdbc.update("insert into direct_messages (id, user_a, user_b, sender_id, body, created_at) values (?, ?, ?, ?, ?, ?)",
                    UUID.randomUUID(), min(me, pat), max(me, pat), me.getId(), "m" + i, java.sql.Timestamp.from(Instant.now().plusSeconds(i)));
        }

        var first = messages.list(me.getId(), ref, null);
        assertThat(first.messages()).hasSize(MessageService.PAGE_SIZE);
        assertThat(first.hasMore()).isTrue();
        assertThat(first.messages().get(first.messages().size() - 1).body()).isEqualTo("m" + (MessageService.PAGE_SIZE + 4)); // newest last
        var older = messages.list(me.getId(), ref, first.messages().get(0).createdAt());
        assertThat(older.messages()).hasSize(5);
        assertThat(older.hasMore()).isFalse();
    }

    private UUID min(User a, User b) { return com.englishspeaking.platform.friends.Friendship.Key.of(a.getId(), b.getId()).userA(); }
    private UUID max(User a, User b) { return com.englishspeaking.platform.friends.Friendship.Key.of(a.getId(), b.getId()).userB(); }

    @Test
    void deleteForMeHidesTheHistoryOnlyForThatPerson() {
        User me = person("Me"), pat = person("Pat");
        befriend(me, "Me", pat);
        messages.send(me.getId(), friendRef(me, pat), "secret");

        messages.clear(me.getId(), friendRef(me, pat));

        assertThat(messages.list(me.getId(), friendRef(me, pat), null).messages()).isEmpty();
        assertThat(messages.list(pat.getId(), friendRef(pat, me), null).messages()).extracting(MessageService.MessageView::body).containsExactly("secret");
        assertThat(directMessages.count()).isEqualTo(1); // nothing was destroyed for the other person
    }

    @Test
    void peopleWhoAreNotFriendsCannotMessageEvenIfTheyTalkedBefore() {
        User me = person("Me"), met = person("Met"), other = person("Other"), othersFriend = person("OthersFriend");
        talked(me, met, 60);
        befriend(other, "Other", othersFriend);
        String theirHandle = friendRef(other, othersFriend);

        expect("FRIEND_NOT_FOUND", () -> messages.send(me.getId(), partnerRef(me, "Met"), "hi")); // a partner handle is not a friend handle
        expect("FRIEND_NOT_FOUND", () -> messages.send(me.getId(), theirHandle, "hi")); // somebody else's friend handle
        expect("FRIEND_NOT_FOUND", () -> messages.send(me.getId(), "nonsense", "hi"));
        expect("FRIEND_NOT_FOUND", () -> messages.list(me.getId(), partnerRef(me, "Met"), null));
        expect("FRIEND_NOT_FOUND", () -> messages.markRead(me.getId(), theirHandle));
        expect("FRIEND_NOT_FOUND", () -> messages.clear(me.getId(), theirHandle));
        assertThat(directMessages.count()).isZero();
    }

    @Test
    void messagesAreRateLimited() {
        User me = person("Me"), pat = person("Pat");
        befriend(me, "Me", pat);
        String ref = friendRef(me, pat);
        for (int i = 0; i < MessageService.MESSAGES_PER_MINUTE; i++) messages.send(me.getId(), ref, "n" + i);

        expect("MESSAGE_RATE", () -> messages.send(me.getId(), ref, "one too many"));
    }

    // ------------------------------------------------------------------ ending a friendship

    @Test
    void blockingEndsEverythingAtOnceAndPreventsAllContact() throws Exception {
        User me = person("Me"), pat = person("Pat");
        befriend(me, "Me", pat);
        messages.send(me.getId(), friendRef(me, pat), "before");
        String myRefToPat = friendRef(me, pat), patRefToMe = friendRef(pat, me);
        String patPartnerRef = partnerRef(me, "Pat");
        online(me); online(pat);
        connections.request(me.getId(), myRefToPat); // an open private-call invitation

        friends.block(pat.getId(), patRefToMe); // Pat blocks me

        assertThat(friends.areFriends(me.getId(), pat.getId())).isFalse();
        assertThat(friends.overview(me.getId()).friends()).isEmpty();
        assertThat(friends.overview(pat.getId()).friends()).isEmpty();
        expect("FRIEND_NOT_FOUND", () -> messages.send(me.getId(), myRefToPat, "hello?"));
        expect("FRIEND_NOT_FOUND", () -> messages.send(pat.getId(), patRefToMe, "hello?"));
        expect("FRIEND_NOT_FOUND", () -> messages.list(me.getId(), myRefToPat, null));
        expect("FRIEND_NOT_FOUND", () -> connections.request(me.getId(), myRefToPat));
        expect("PARTNER_NOT_FOUND", () -> friends.sendRequest(me.getId(), patPartnerRef)); // they no longer even appear
        assertThat(partners.list(me.getId())).isEmpty();
        assertThat(moderation.excludedPartners(me.getId())).contains(pat.getId()); // and never matched at random
        assertThat(requests.findByRequesterIdAndStatus(me.getId(), FriendRequestStatus.PENDING)).isEmpty();
        assertThat(connectionsPending()).isZero();
    }

    private long connectionsPending() {
        return jdbc.queryForObject("select count(*) from partner_requests where status = 'PENDING'", Long.class);
    }

    @Test
    void removingAFriendEndsTheFriendshipAndDeletesTheConversationButNotMatching() {
        User me = person("Me"), pat = person("Pat");
        befriend(me, "Me", pat);
        messages.send(me.getId(), friendRef(me, pat), "hello");
        String ref = friendRef(me, pat);

        friends.remove(me.getId(), ref);

        assertThat(friends.areFriends(me.getId(), pat.getId())).isFalse();
        assertThat(directMessages.count()).isZero();
        expect("FRIEND_NOT_FOUND", () -> messages.send(me.getId(), ref, "still there?"));
        expect("FRIEND_NOT_FOUND", () -> friends.remove(me.getId(), ref));
        assertThat(moderation.excludedPartners(me.getId())).isEmpty();
        friends.sendRequest(me.getId(), partnerRef(me, "Pat")); // they remain previous partners and can be asked again
        assertThat(friends.overview(pat.getId()).incoming()).hasSize(1);
    }

    @Test
    void oldMessagesNeverReappearIfPeopleBefriendAgainAfterABlockAndUnblock() {
        User me = person("Me"), pat = person("Pat");
        befriend(me, "Me", pat);
        messages.send(me.getId(), friendRef(me, pat), "old message");
        friends.block(me.getId(), friendRef(me, pat));
        moderation.unblock(me.getId(), pat.getId());

        friends.sendRequest(me.getId(), partnerRef(me, "Pat"));
        friends.accept(pat.getId(), friends.overview(pat.getId()).incoming().get(0).id());

        assertThat(messages.list(me.getId(), friendRef(me, pat), null).messages()).isEmpty();
    }

    @Test
    void reportingAFriendRecordsAReportWithoutACallAndCanBlockToo() {
        User me = person("Me"), pat = person("Pat");
        befriend(me, "Me", pat);

        friends.report(me.getId(), friendRef(me, pat), new ModerationService.ReportRequest(ReportReason.HARASSMENT, "  rude messages ", true));

        assertThat(reports.count()).isEqualTo(1);
        assertThat(reports.findAll().get(0).getCallId()).isNull();
        assertThat(friends.areFriends(me.getId(), pat.getId())).isFalse(); // alsoBlock
        assertThat(moderation.excludedPartners(me.getId())).contains(pat.getId());
    }

    @Test
    void deletingAnAccountRemovesItsFriendshipsRequestsAndMessages() {
        User me = person("Me"), pat = person("Pat"), third = person("Third");
        befriend(me, "Me", pat);
        messages.send(me.getId(), friendRef(me, pat), "bye");
        talked(me, third, 60);
        friends.sendRequest(me.getId(), partnerRef(me, "Third"));

        events.publishEvent(new AccountService.AccountDeletedEvent(me.getId()));

        assertThat(friendships.findAllFor(pat.getId())).isEmpty();
        assertThat(directMessages.count()).isZero();
        assertThat(requests.count()).isZero();
    }

    // ------------------------------------------------------------------ friends list: what it shows, and what it costs

    /** The list is built from one batched query; its per-friend cut-offs must stay exactly those the single-friend code used. */
    @Test
    void theFriendsListHonoursDeleteForMeAndTheReadMarkerPerFriend() {
        User me = person("Me"), pat = person("Pat"), sam = person("Sam");
        befriend(me, "Me", pat);
        befriend(me, "Me", sam);
        messages.send(pat.getId(), friendRef(pat, me), "one");
        messages.send(pat.getId(), friendRef(pat, me), "two");
        messages.send(sam.getId(), friendRef(sam, me), "from sam");

        java.util.function.Function<User, FriendService.FriendSummary> mineWith = f ->
                friends.overview(me.getId()).friends().stream().filter(s -> s.ref().equals(friendRef(me, f))).findFirst().orElseThrow();
        assertThat(mineWith.apply(pat).unread()).isEqualTo(2);
        assertThat(mineWith.apply(sam).unread()).isEqualTo(1);

        messages.clear(me.getId(), friendRef(me, pat)); // hides Pat's messages for me only
        assertThat(mineWith.apply(pat).unread()).isZero();
        assertThat(mineWith.apply(pat).lastMessageAt()).isNull();
        assertThat(mineWith.apply(sam).unread()).isEqualTo(1); // Sam's conversation is untouched
        assertThat(friends.overview(pat.getId()).friends().get(0).lastMessageAt()).isNotNull(); // and Pat still sees theirs

        messages.send(pat.getId(), friendRef(pat, me), "three");
        assertThat(mineWith.apply(pat).unread()).isEqualTo(1);
        assertThat(mineWith.apply(pat).lastMessageAt()).isNotNull();

        messages.markRead(me.getId(), friendRef(me, pat));
        assertThat(mineWith.apply(pat).unread()).isZero();
        assertThat(mineWith.apply(pat).lastMessageAt()).isNotNull(); // read, but still the newest visible message
        assertThat(mineWith.apply(sam).unread()).isEqualTo(1);
    }

    /**
     * The friends list is polled by every signed-in client. It used to run about six statements per friend (a user, profile, preferences,
     * conversation state and two message queries each): 245 statements for 40 friends. It now costs the same however many friends there are.
     */
    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void theFriendsListCostsTheSameNumberOfStatementsNoMatterHowManyFriends() {
        List<User> created = new ArrayList<>();
        try {
            User me = person("Me");
            created.add(me);
            java.util.function.IntFunction<Long> statementsForOneRefresh = (ignored) -> {
                var stats = entityManagerFactory.unwrap(org.hibernate.SessionFactory.class).getStatistics();
                long before = stats.getPrepareStatementCount();
                friends.overview(me.getId());
                return stats.getPrepareStatementCount() - before;
            };
            for (int i = 0; i < 2; i++) {
                User f = person("Friend" + i);
                created.add(f);
                befriend(me, "Me", f);
                messages.send(f.getId(), friendRef(f, me), "hello");
            }
            long withTwo = statementsForOneRefresh.apply(0);
            for (int i = 2; i < 12; i++) {
                User f = person("Friend" + i);
                created.add(f);
                befriend(me, "Me", f);
                messages.send(f.getId(), friendRef(f, me), "hello");
            }
            long withTwelve = statementsForOneRefresh.apply(0);

            assertThat(friends.overview(me.getId()).friends()).hasSize(12);
            assertThat(withTwelve).as("statements for 12 friends vs 2 friends").isEqualTo(withTwo);
            assertThat(withTwelve).as("statements for one friends-list refresh").isLessThanOrEqualTo(10);
        } finally {
            for (User u : created) {
                jdbc.update("delete from call_sessions where id in (select call_id from call_participants where user_id = ?)", u.getId());
                jdbc.update("delete from users where id = ?", u.getId());
            }
        }
    }

    // ------------------------------------------------------------------ live pushes (need real commits)

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void aNewMessageIsPushedToTheRecipientAfterTheCommit() throws Exception {
        User me = null, pat = null;
        try {
            me = person("Me");
            pat = person("Pat");
            talked(me, pat, 60);
            Socket patSocket = online(pat);
            friends.sendRequest(me.getId(), partnerRef(me, "Pat"));
            friends.accept(pat.getId(), friends.overview(pat.getId()).incoming().get(0).id());
            assertThat(patSocket.of("friends.changed")).isNotEmpty();

            messages.send(me.getId(), friendRef(me, pat), "ping");

            var pushed = patSocket.of("message.new");
            assertThat(pushed).hasSize(1);
            assertThat(pushed.get(0).get("friendRef").asText()).isEqualTo(friendRef(pat, me));
            assertThat(pushed.get(0).get("message").get("body").asText()).isEqualTo("ping");
            assertThat(pushed.get(0).get("message").get("mine").asBoolean()).isFalse();
            assertThat(pushed.get(0).toString()).doesNotContain(me.getId().toString()).doesNotContain("@");
        } finally {
            for (User u : new User[]{me, pat}) {
                if (u == null) continue;
                jdbc.update("delete from call_sessions where id in (select call_id from call_participants where user_id = ?)", u.getId());
                jdbc.update("delete from users where id = ?", u.getId());
            }
        }
    }
}
