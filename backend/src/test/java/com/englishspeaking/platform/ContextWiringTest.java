package com.englishspeaking.platform;

import com.englishspeaking.platform.auth.*;
import com.englishspeaking.platform.calling.CallParticipantRepository;
import com.englishspeaking.platform.calling.CallSessionRepository;
import com.englishspeaking.platform.feedback.CallFeedbackRepository;
import com.englishspeaking.platform.matching.MatchmakingService;
import com.englishspeaking.platform.moderation.UserBlockRepository;
import com.englishspeaking.platform.moderation.UserReportRepository;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.statistics.DailyActivityRepository;
import com.englishspeaking.platform.statistics.UserStatisticsRepository;
import com.englishspeaking.platform.topics.TopicRepository;
import com.englishspeaking.platform.user.UserRepository;
import com.englishspeaking.platform.websocket.SignalingHandler;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies that the whole application context wires up (no cycles, config properties bind, security and
 * websocket configuration are valid) WITHOUT a database: JPA/Flyway/DataSource auto-configuration is excluded and
 * repositories are mocks. This does not exercise SQL, mappings or the Flyway migrations.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, // the websocket container needs a real servlet container
        properties = {
                "spring.autoconfigure.exclude="
                        + "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,"
                        + "org.springframework.boot.autoconfigure.jdbc.DataSourceTransactionManagerAutoConfiguration,"
                        + "org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration,"
                        + "org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration,"
                        + "org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration",
                "spring.config.import=",
                "management.endpoint.health.group.readiness.include=readinessState", // no DataSource in this test
                "management.health.redis.enabled=false",
                "app.jwt.secret=" + TestSupport.SECRET,
                "spring.datasource.password=unused"
        })
class ContextWiringTest {
    @MockitoBean UserRepository users;
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

    @Autowired ApplicationContext context;

    @Test
    void contextLoadsAndKeyBeansExist() {
        assertThat(context.getBean(AuthService.class)).isNotNull();
        assertThat(context.getBean(MatchmakingService.class)).isNotNull();
        assertThat(context.getBean(SignalingHandler.class)).isNotNull();
        assertThat(context.getBean(SecurityFilterChain.class)).isNotNull();
        assertThat(context.getBeanProvider(JavaMailSender.class).getIfAvailable()).as("no SMTP configured").isNull();
        assertThat(context.getBeanProvider(com.englishspeaking.platform.notification.ResendClient.class).getIfAvailable()).as("no Resend key configured").isNull();
    }
}
