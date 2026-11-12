package com.englishspeaking.platform;

import com.englishspeaking.platform.auth.EmailVerificationTokenRepository;
import com.englishspeaking.platform.auth.PasswordResetTokenRepository;
import com.englishspeaking.platform.auth.RefreshTokenRepository;
import com.englishspeaking.platform.calling.CallParticipantRepository;
import com.englishspeaking.platform.calling.CallSessionRepository;
import com.englishspeaking.platform.feedback.CallFeedbackRepository;
import com.englishspeaking.platform.moderation.UserBlockRepository;
import com.englishspeaking.platform.moderation.UserReportRepository;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.statistics.DailyActivityRepository;
import com.englishspeaking.platform.statistics.UserStatisticsRepository;
import com.englishspeaking.platform.topics.TopicRepository;
import com.englishspeaking.platform.user.UserRepository;
import com.sun.net.httpserver.HttpServer;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Full application context (real Spring Security chain, no database) with a local stand-in for Turnix. Shared by the endpoint
 * tests so the token, the forwarded-header handling and the authentication of /api/calls/ice-servers are checked through HTTP.
 */
public abstract class IceEndpointTestBase {
    public static final String TOKEN = "tx_ENDPOINT_TEST_TOKEN_999";
    /** A reply whose expiry is one hour from now, as Turnix would send for ttl=3600. */
    public static String reply() {
        return "{\"iceServers\":[{\"urls\":[\"stun:stun.turnix.io:3478\"]},"
                + "{\"username\":\"u-1\",\"credential\":\"c-1\",\"urls\":[\"turn:eu.turnix.io:3478?transport=udp\"]}],\"expiresAt\":\""
                + java.time.Instant.now().plusSeconds(3600) + "\"}";
    }
    /** Each entry: Authorization header | X-TURN-CLIENT-IP header (or "-"). */
    public static final CopyOnWriteArrayList<String> SEEN = new CopyOnWriteArrayList<>();
    public static final HttpServer TURNIX = start();

    private static HttpServer start() {
        try {
            HttpServer s = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            s.createContext("/api/v1/credentials/ice", ex -> {
                String ip = ex.getRequestHeaders().getFirst("X-TURN-CLIENT-IP");
                SEEN.add(ex.getRequestHeaders().getFirst("Authorization") + " | " + (ip == null ? "-" : ip));
                ex.getRequestBody().readAllBytes();
                byte[] out = reply().getBytes(StandardCharsets.UTF_8);
                ex.getResponseHeaders().add("content-type", "application/json");
                ex.sendResponseHeaders(200, out.length);
                ex.getResponseBody().write(out);
                ex.close();
            });
            s.start();
            return s;
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String turnixUrl() { return "http://127.0.0.1:" + TURNIX.getAddress().getPort() + "/api/v1/credentials/ice"; }

    @MockitoBean com.englishspeaking.platform.user.UserRepository users;
    @MockitoBean UserProfileRepository profiles;
    @MockitoBean UserPreferencesRepository preferences;
    @MockitoBean UserStatisticsRepository statistics;
    @MockitoBean DailyActivityRepository dailyActivity;
    @MockitoBean RefreshTokenRepository refreshTokens;
    @MockitoBean EmailVerificationTokenRepository verificationTokens;
    @MockitoBean PasswordResetTokenRepository resetTokens;
    @MockitoBean TopicRepository topics;
    @MockitoBean CallSessionRepository callSessions;
    @MockitoBean CallParticipantRepository callParticipants;
    @MockitoBean CallFeedbackRepository feedback;
    @MockitoBean UserBlockRepository blocks;
    @MockitoBean UserReportRepository reports;
    @MockitoBean com.englishspeaking.platform.moderation.ModerationActionRepository moderationActions;
    @MockitoBean com.englishspeaking.platform.partners.PartnerRequestRepository partnerRequests;
    @MockitoBean com.englishspeaking.platform.friends.FriendRequestRepository friendRequests;
    @MockitoBean com.englishspeaking.platform.friends.FriendshipRepository friendshipRepo;
    @MockitoBean com.englishspeaking.platform.friends.DirectMessageRepository directMessages;
    @MockitoBean com.englishspeaking.platform.friends.ConversationStateRepository conversationStates;
    @MockitoBean com.englishspeaking.platform.learn.LearningStore learningStore;
    @MockitoBean com.englishspeaking.platform.coach.TutorPreferenceRepository tutorPreferenceRepo;
    @MockitoBean org.springframework.transaction.PlatformTransactionManager transactionManager; // no database in this context
}
