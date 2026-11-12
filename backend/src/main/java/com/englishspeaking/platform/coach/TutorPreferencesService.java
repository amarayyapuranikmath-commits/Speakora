package com.englishspeaking.platform.coach;

import com.englishspeaking.platform.common.ApiException;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.util.UUID;

/**
 * The learner's tutor settings: the language explanations are given in and how fast the voice speaks. These are settings, not
 * conversation: the coach conversation itself is never stored (see {@link TutorService}).
 */
@Service
public class TutorPreferencesService {
    /** {@code speechSpeed} is SLOW, NORMAL (the default) or FAST: how fast the voice speaks. */
    public record Preferences(@Size(max = 40) String explanationLanguage, String speechSpeed) {
        public Preferences(String explanationLanguage) { this(explanationLanguage, "NORMAL"); }
    }

    public record SpeedRequest(@NotBlank @Pattern(regexp = "SLOW|NORMAL|FAST", message = "Choose Slow, Normal or Fast.") String speechSpeed) {}

    private final TutorPreferenceRepository tutorPreferences;
    private final TransactionTemplate tx;
    private final Clock clock;

    public TutorPreferencesService(TutorPreferenceRepository tutorPreferences, PlatformTransactionManager txManager, Clock clock) {
        this.tutorPreferences = tutorPreferences;
        this.tx = new TransactionTemplate(txManager);
        this.clock = clock;
    }

    public Preferences preferences(UUID user) {
        return tx.execute(s -> tutorPreferences.findById(user).map(p -> new Preferences(p.getExplanationLanguage(), p.getSpeechSpeed())).orElse(new Preferences(null, "NORMAL")));
    }

    public Preferences setPreferences(UUID user, String language) {
        String checked = TutorService.language(language);
        return tx.execute(s -> {
            TutorPreference p = tutorPreferences.findById(user).orElseGet(() -> new TutorPreference(user, clock.instant()));
            p.setExplanationLanguage(checked, clock.instant());
            tutorPreferences.save(p);
            return new Preferences(checked, p.getSpeechSpeed());
        });
    }

    /** Saves how fast the tutor's voice speaks. Only the speed changes; the explanation language is left as it is. */
    public Preferences setSpeechSpeed(UUID user, String speed) {
        if (!"SLOW".equals(speed) && !"NORMAL".equals(speed) && !"FAST".equals(speed)) throw ApiException.badRequest("INVALID_SPEED", "Choose Slow, Normal or Fast.");
        return tx.execute(s -> {
            TutorPreference p = tutorPreferences.findById(user).orElseGet(() -> new TutorPreference(user, clock.instant()));
            p.setSpeechSpeed(speed, clock.instant());
            tutorPreferences.save(p);
            return new Preferences(p.getExplanationLanguage(), speed);
        });
    }
}
