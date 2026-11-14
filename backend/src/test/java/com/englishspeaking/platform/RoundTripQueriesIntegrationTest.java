package com.englishspeaking.platform;

import com.englishspeaking.platform.moderation.UserBlock;
import com.englishspeaking.platform.moderation.UserBlockRepository;
import com.englishspeaking.platform.notification.MailService;
import com.englishspeaking.platform.preferences.UserPreferences;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.LocalDate;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/** The queries that replaced several sequential round trips, against a real PostgreSQL (skipped when the test database is not reachable). */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Transactional
class RoundTripQueriesIntegrationTest {
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
    @Autowired UserRepository users;
    @Autowired UserProfileRepository profiles;
    @Autowired UserPreferencesRepository preferences;
    @Autowired UserBlockRepository blocks;

    private User person(String tag, boolean withPreferences) {
        User u = new User(tag + "." + UUID.randomUUID() + "@it.example.com", "hash", LocalDate.of(1990, 1, 1));
        users.saveAndFlush(u);
        profiles.saveAndFlush(new UserProfile(u.getId(), tag));
        if (withPreferences) preferences.saveAndFlush(new UserPreferences(u.getId()));
        return u;
    }

    @Test
    void accountProfileAndPreferencesComeBackAsOneRow() {
        User u = person("one", true);
        var rows = users.findAccountProfileAndPreferences(u.getId());
        assertThat(rows).hasSize(1);
        assertThat(((User) rows.get(0)[0]).getId()).isEqualTo(u.getId());
        assertThat(((UserProfile) rows.get(0)[1]).getDisplayName()).isEqualTo("one");
        assertThat(rows.get(0)[2]).isInstanceOf(UserPreferences.class);
    }

    @Test
    void whenPreferencesOrTheAccountAreMissingTheCombinedQueryIsEmptySoTheStepByStepPathReportsWhichOne() {
        User noPrefs = person("noprefs", false);
        assertThat(users.findAccountProfileAndPreferences(noPrefs.getId())).isEmpty();
        assertThat(users.findAccountProfileAndPreferences(UUID.randomUUID())).isEmpty();
    }

    @Test
    void blocksInEitherDirectionComeBackFromOneQueryAndStrangersDoNot() {
        User me = person("me", true), iBlocked = person("iblocked", true), blockedMe = person("blockedme", true), stranger = person("stranger", true);
        blocks.saveAndFlush(new UserBlock(me.getId(), iBlocked.getId()));
        blocks.saveAndFlush(new UserBlock(blockedMe.getId(), me.getId()));
        blocks.saveAndFlush(new UserBlock(stranger.getId(), iBlocked.getId())); // unrelated to me
        assertThat(blocks.findEitherWay(me.getId())).containsExactlyInAnyOrder(iBlocked.getId(), blockedMe.getId());
        assertThat(blocks.findEitherWay(stranger.getId())).containsExactly(iBlocked.getId());
    }

    @Test
    void aPersonBlockedBothWaysIsListedOnce() {
        User me = person("me2", true), other = person("other2", true);
        blocks.saveAndFlush(new UserBlock(me.getId(), other.getId()));
        blocks.saveAndFlush(new UserBlock(other.getId(), me.getId()));
        assertThat(blocks.findEitherWay(me.getId())).containsExactly(other.getId());
    }
}
