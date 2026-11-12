package com.englishspeaking.platform.notification;

import com.englishspeaking.platform.preferences.UserPreferences;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.security.RateLimiter;
import com.englishspeaking.platform.statistics.UserStatisticsRepository;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;

/**
 * Friendly practice reminders for users who opted in: sent in the early evening of the user's own time zone, only after
 * a couple of quiet days, and at most once a week.
 */
@Service
public class ReminderService {
    private static final Logger log = LoggerFactory.getLogger(ReminderService.class);
    static final int QUIET_DAYS = 2;
    static final Duration MIN_INTERVAL = Duration.ofDays(7);
    static final int FIRST_HOUR = 17;   // inclusive, local time
    static final int LAST_HOUR = 20;    // exclusive, local time
    private static final int PAGE_SIZE = 200;

    private final UserPreferencesRepository preferences;
    private final UserRepository users;
    private final UserProfileRepository profiles;
    private final UserStatisticsRepository statistics;
    private final MailService mail;
    private final RateLimiter limiter;
    private final Clock clock;

    public ReminderService(UserPreferencesRepository preferences, UserRepository users, UserProfileRepository profiles,
                           UserStatisticsRepository statistics, MailService mail, RateLimiter limiter, Clock clock) {
        this.preferences = preferences;
        this.users = users;
        this.profiles = profiles;
        this.statistics = statistics;
        this.mail = mail;
        this.limiter = limiter;
        this.clock = clock;
    }

    /** Hourly. A shared lock keeps several backend instances from each sending the same reminder. */
    @Scheduled(cron = "0 5 * * * *")
    public void run() {
        Instant now = clock.instant();
        if (!limiter.tryAcquire("reminders:" + now.truncatedTo(java.time.temporal.ChronoUnit.HOURS), 1, Duration.ofMinutes(55))) return;
        int sent = sendDue(now);
        if (sent > 0) log.info("Sent {} practice reminder(s)", sent);
    }

    @Transactional
    public int sendDue(Instant now) {
        int sent = 0;
        int page = 0;
        Page<UserPreferences> batch;
        do {
            batch = preferences.findReminderCandidates(now.minus(MIN_INTERVAL), PageRequest.of(page++, PAGE_SIZE, Sort.by("userId")));
            for (UserPreferences p : batch.getContent()) {
                if (remind(p, now)) sent++;
            }
        } while (batch.hasNext());
        return sent;
    }

    private boolean remind(UserPreferences p, Instant now) {
        User user = users.findById(p.getUserId()).orElse(null);
        if (user == null) return false;
        var profile = profiles.findById(p.getUserId()).orElse(null);
        ZonedDateTime local = now.atZone(zoneOf(profile == null ? null : profile.getTimeZone()));
        if (local.getHour() < FIRST_HOUR || local.getHour() >= LAST_HOUR) return false;
        LocalDate lastActive = statistics.findById(p.getUserId()).map(s -> s.getLastActivityDate()).orElse(null);
        if (lastActive == null) lastActive = user.getCreatedAt().atZone(local.getZone()).toLocalDate();
        if (Duration.between(lastActive.atStartOfDay(local.getZone()), local).toDays() < QUIET_DAYS) return false;
        mail.sendReminderEmail(user.getEmail(), profile == null ? "there" : profile.getDisplayName());
        p.setLastReminderAt(now);
        return true;
    }

    private static ZoneId zoneOf(String tz) {
        try {
            return tz == null || tz.isBlank() ? ZoneOffset.UTC : ZoneId.of(tz);
        } catch (DateTimeException e) {
            return ZoneOffset.UTC;
        }
    }
}
