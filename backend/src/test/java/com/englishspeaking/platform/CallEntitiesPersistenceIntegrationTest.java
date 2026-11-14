package com.englishspeaking.platform;

import com.englishspeaking.platform.calling.CallParticipant;
import com.englishspeaking.platform.calling.CallParticipantRepository;
import com.englishspeaking.platform.calling.CallSession;
import com.englishspeaking.platform.calling.CallSessionRepository;
import com.englishspeaking.platform.calling.CallStatus;
import com.englishspeaking.platform.notification.MailService;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import jakarta.persistence.EntityManager;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * CallSession and CallParticipant take their ids from the application, and implement Persistable so that creating one is a plain INSERT (before, Spring
 * Data could not tell new from existing and ran a SELECT first). This proves, against a real PostgreSQL, which statements really run and that updates,
 * reloads and re-saves of existing rows still behave.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Transactional
class CallEntitiesPersistenceIntegrationTest {
    private static final String URL = "jdbc:postgresql://localhost:5432/english_speaking_test";
    private static String user = "esp_app";
    private static String password;

    @BeforeAll
    static void requireTestDatabase() {
        try {
            Matcher m = Pattern.compile("(?m)^DB_PASSWORD=([^\\r\\n]*)$").matcher(Files.readString(Path.of("../.env")));
            Assumptions.assumeTrue(m.find(), "no DB_PASSWORD in ../.env");
            password = m.group(1).trim();
            try (var c = DriverManager.getConnection(URL, user, password)) { c.isValid(2); }
        } catch (Exception e) {
            Assumptions.abort("PostgreSQL test database not reachable: " + e.getClass().getSimpleName());
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> URL);
        registry.add("spring.datasource.username", () -> user);
        registry.add("spring.datasource.password", () -> password);
    }

    @MockitoBean MailService mail;
    @Autowired CallSessionRepository sessions;
    @Autowired CallParticipantRepository participants;
    @Autowired UserRepository users;
    @Autowired UserProfileRepository profiles;
    @Autowired EntityManager em;
    @Autowired JdbcTemplate jdbc;
    @Autowired jakarta.persistence.EntityManagerFactory emf;

    Statistics stats;
    UUID alice, bob;

    @BeforeEach
    void setUp() {
        stats = emf.unwrap(SessionFactory.class).getStatistics();
        stats.setStatisticsEnabled(true);
        alice = person("alice");
        bob = person("bob");
        em.flush();
        em.clear();
        stats.clear();
    }

    private UUID person(String tag) {
        User u = new User(tag + "." + UUID.randomUUID() + "@it.example.com", "hash", LocalDate.of(1990, 1, 1));
        users.save(u);
        profiles.save(new UserProfile(u.getId(), tag));
        return u.getId();
    }

    private long rows(String table, UUID callId) { return jdbc.queryForObject("select count(*) from " + table + " where " + (table.equals("call_sessions") ? "id" : "call_id") + " = ?", Long.class, callId); }

    @Test
    void creatingACallIsThreeInsertsAndNoSelectAtAll() {
        UUID id = UUID.randomUUID();
        sessions.save(new CallSession(id, null, Instant.now()));
        participants.saveAll(List.of(new CallParticipant(id, alice), new CallParticipant(id, bob)));
        em.flush();
        assertThat(stats.getEntityInsertCount()).isEqualTo(3);
        assertThat(stats.getEntityLoadCount()).isZero();
        assertThat(stats.getPrepareStatementCount()).as("statements sent to PostgreSQL").isEqualTo(3);
        assertThat(rows("call_sessions", id)).isEqualTo(1);
        assertThat(rows("call_participants", id)).isEqualTo(2);
    }

    @Test
    void aLoadedCallCanBeChangedAndThatIsAnUpdateNotAnInsert() {
        UUID id = UUID.randomUUID();
        sessions.save(new CallSession(id, null, Instant.now()));
        participants.saveAll(List.of(new CallParticipant(id, alice), new CallParticipant(id, bob)));
        em.flush();
        em.clear();
        stats.clear();

        CallSession loaded = sessions.findById(id).orElseThrow();
        loaded.transitionTo(CallStatus.CONNECTING);
        sessions.save(loaded); // saving something that came from the database
        CallParticipant p = participants.findByCallId(id).stream().filter(x -> x.getUserId().equals(alice)).findFirst().orElseThrow();
        p.markJoined(Instant.now());
        participants.save(p);
        em.flush();

        assertThat(stats.getEntityInsertCount()).isZero();
        assertThat(stats.getEntityUpdateCount()).isEqualTo(2);
        em.clear();
        assertThat(sessions.findById(id).orElseThrow().getStatus()).isEqualTo(CallStatus.CONNECTING);
        assertThat(participants.findByCallId(id).stream().filter(x -> x.getUserId().equals(alice)).findFirst().orElseThrow().getJoinedAt()).isNotNull();
        assertThat(rows("call_sessions", id)).isEqualTo(1);
    }

    @Test
    void aDetachedCopySavedLaterIsMergedAsAnUpdateAndNeverDuplicated() {
        UUID id = UUID.randomUUID();
        sessions.save(new CallSession(id, null, Instant.now()));
        em.flush();
        em.clear();
        CallSession detached = sessions.findById(id).orElseThrow();
        em.detach(detached);
        detached.transitionTo(CallStatus.CONNECTING);
        sessions.saveAndFlush(detached);
        em.clear();
        assertThat(sessions.findById(id).orElseThrow().getStatus()).isEqualTo(CallStatus.CONNECTING);
        assertThat(rows("call_sessions", id)).isEqualTo(1);
    }

    @Test
    void theLifecycleFlagFlipsOnPersistAndLoad() {
        UUID id = UUID.randomUUID();
        CallSession fresh = new CallSession(id, null, Instant.now());
        assertThat(fresh.isNew()).isTrue();
        sessions.saveAndFlush(fresh);
        assertThat(fresh.isNew()).isFalse();
        em.clear();
        assertThat(sessions.findById(id).orElseThrow().isNew()).isFalse();
        CallParticipant p = new CallParticipant(id, alice);
        assertThat(p.isNew()).isTrue();
        participants.saveAndFlush(p);
        assertThat(p.isNew()).isFalse();
    }

    @Test
    void savingANewObjectWithAnIdThatAlreadyExistsFailsInsteadOfSilentlyOverwriting() {
        // Behaviour change on purpose: before, this quietly became an update of the existing row. No production path does it (calls are created in one place
        // with a fresh random id); an accidental duplicate now fails loudly.
        UUID id = UUID.randomUUID();
        sessions.saveAndFlush(new CallSession(id, null, Instant.now()));
        em.clear();
        assertThatThrownBy(() -> sessions.saveAndFlush(new CallSession(id, null, Instant.now()))).isInstanceOfAny(DataAccessException.class, jakarta.persistence.PersistenceException.class);
    }
}
