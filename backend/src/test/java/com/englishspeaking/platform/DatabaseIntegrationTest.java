package com.englishspeaking.platform;

import com.englishspeaking.platform.notification.MailService;
import com.englishspeaking.platform.notification.ReminderService;
import com.englishspeaking.platform.preferences.UserPreferences;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.statistics.DailyActivityRepository;
import com.englishspeaking.platform.statistics.StatisticsService;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import com.englishspeaking.platform.user.UserStatus;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Runs the real repositories, Flyway migrations and Hibernate mappings against the local PostgreSQL TEST database
 * (english_speaking_test, credentials from ../.env). Skipped automatically when that database is not reachable, so the
 * suite still passes on a machine without it. Every test rolls back.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Transactional
class DatabaseIntegrationTest {
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
    @Autowired ReminderService reminders;
    @Autowired StatisticsService statistics;
    @Autowired DailyActivityRepository daily;

    private User newUser(String tag, boolean verified, UserStatus status, boolean remindersOn, String tz) {
        User u = new User(tag + "." + UUID.randomUUID() + "@it.example.com", "hash", LocalDate.of(1990, 1, 1));
        u.setEmailVerified(verified);
        u.setStatus(status);
        users.saveAndFlush(u);
        profiles.save(new UserProfile(u.getId(), tag));
        UserPreferences p = new UserPreferences(u.getId());
        p.setNotifyEmailReminders(remindersOn);
        preferences.saveAndFlush(p);
        if (tz != null) { UserProfile pr = profiles.findById(u.getId()).orElseThrow(); pr.setTimeZone(tz); profiles.saveAndFlush(pr); }
        return u;
    }

    @Test
    void reminderQueryReturnsOnlyOptedInActiveVerifiedUsersNotRecentlyReminded() {
        User eligible = newUser("eligible", true, UserStatus.ACTIVE, true, null);
        User optedOut = newUser("optedout", true, UserStatus.ACTIVE, false, null);
        User unverified = newUser("unverified", false, UserStatus.ACTIVE, true, null);
        User suspended = newUser("suspended", true, UserStatus.SUSPENDED, true, null);
        User recent = newUser("recent", true, UserStatus.ACTIVE, true, null);
        UserPreferences rp = preferences.findById(recent.getId()).orElseThrow();
        rp.setLastReminderAt(Instant.now().minusSeconds(3600));
        preferences.saveAndFlush(rp);

        var ids = preferences.findReminderCandidates(Instant.now().minusSeconds(7 * 86400), PageRequest.of(0, 500)).getContent()
                .stream().map(UserPreferences::getUserId).toList();

        assertThat(ids).contains(eligible.getId()).doesNotContain(optedOut.getId(), unverified.getId(), suspended.getId(), recent.getId());
    }

    @Test
    void reminderServiceEmailsAnEligibleUserInTheirEveningAndRecordsIt() {
        User u = newUser("evening", true, UserStatus.ACTIVE, true, "Asia/Kolkata");
        // Account created long ago in the user's eyes: use "now" far in the future relative to created_at.
        Instant eveningKolkata = Instant.now().plusSeconds(10 * 86400).atZone(java.time.ZoneOffset.UTC).toLocalDate().atTime(12, 30).toInstant(java.time.ZoneOffset.UTC);

        int sent = reminders.sendDue(eveningKolkata);

        assertThat(sent).isGreaterThanOrEqualTo(1);
        verify(mail).sendReminderEmail(eq(u.getEmail()), eq("evening"));
        assertThat(preferences.findById(u.getId()).orElseThrow().getLastReminderAt()).isEqualTo(eveningKolkata);

        // a second run in the same window must not email them again
        reminders.sendDue(eveningKolkata.plusSeconds(60));
        verify(mail, org.mockito.Mockito.times(1)).sendReminderEmail(eq(u.getEmail()), any());
    }

    @Test
    void remindersAreLimitedToOnePerWeekAcrossRepeatedRuns() {
        User u = newUser("weekly", true, UserStatus.ACTIVE, true, "UTC");
        Instant t0 = Instant.now().plusSeconds(10 * 86400).atZone(java.time.ZoneOffset.UTC).toLocalDate().atTime(18, 30).toInstant(java.time.ZoneOffset.UTC);
        reminders.sendDue(t0);
        verify(mail, org.mockito.Mockito.times(1)).sendReminderEmail(eq(u.getEmail()), any());
        reminders.sendDue(t0.plusSeconds(3 * 86400)); // still inside the 7-day limit
        reminders.sendDue(t0.plusSeconds(6 * 86400));
        verify(mail, org.mockito.Mockito.times(1)).sendReminderEmail(eq(u.getEmail()), any());
        reminders.sendDue(t0.plusSeconds(8 * 86400)); // a week has passed and they are still quiet
        verify(mail, org.mockito.Mockito.times(2)).sendReminderEmail(eq(u.getEmail()), any());
    }

    @Test
    void usersOutsideTheirEveningWindowAreNotEmailed() {
        User u = newUser("morning", true, UserStatus.ACTIVE, true, "Asia/Kolkata");
        Instant morningKolkata = Instant.now().plusSeconds(10 * 86400).atZone(java.time.ZoneOffset.UTC).toLocalDate().atTime(3, 0).toInstant(java.time.ZoneOffset.UTC);
        reminders.sendDue(morningKolkata);
        verify(mail, never()).sendReminderEmail(eq(u.getEmail()), any());
    }

    @Test
    void completedCallActivityIsUpsertedPerDayInTheUsersZone() {
        User u = newUser("stats", true, UserStatus.ACTIVE, false, "Asia/Kolkata");
        statistics.recordCompletedCall(u.getId(), 120, Instant.parse("2026-11-09T20:00:00Z")); // 01:30 on Nov 10 in Kolkata
        statistics.recordCompletedCall(u.getId(), 60, Instant.parse("2026-11-09T21:00:00Z"));  // same local day
        statistics.recordCompletedCall(u.getId(), 30, Instant.parse("2026-11-10T10:00:00Z"));  // 15:30 on Nov 10 local

        var rows = daily.findRange(u.getId(), LocalDate.of(2026, 11, 8), LocalDate.of(2026, 11, 12));

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getId().date()).isEqualTo(LocalDate.of(2026, 11, 10));
        assertThat(rows.get(0).getSeconds()).isEqualTo(210);
        assertThat(rows.get(0).getCalls()).isEqualTo(3);
        assertThat(daily.sumSeconds(u.getId(), LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 30))).isEqualTo(210);
    }

    @Test
    void moderatorUserSearchMatchesEmailOrNameAndFiltersByStatus() {
        User active = newUser("searchable", true, UserStatus.ACTIVE, false, null);
        User gone = newUser("searchable", true, UserStatus.SUSPENDED, false, null);

        List<User> all = users.search("searchable", null, PageRequest.of(0, 50)).getContent();
        List<User> suspendedOnly = users.search("SEARCHABLE", UserStatus.SUSPENDED, PageRequest.of(0, 50)).getContent();

        assertThat(all).extracting(User::getId).contains(active.getId(), gone.getId());
        assertThat(suspendedOnly).extracting(User::getId).contains(gone.getId()).doesNotContain(active.getId());
    }
}
