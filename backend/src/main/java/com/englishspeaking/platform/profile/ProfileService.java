package com.englishspeaking.platform.profile;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.profile.ProfileDtos.ProfileRequest;
import com.englishspeaking.platform.profile.ProfileDtos.ProfileResponse;
import com.englishspeaking.platform.topics.TopicService;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DateTimeException;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class ProfileService {
    public static final Set<String> GOALS = Set.of("fluency", "confidence", "interviews", "travel", "work", "exams", "pronunciation", "vocabulary");

    private final UserProfileRepository profiles;
    private final UserRepository users;
    private final TopicService topics;

    public ProfileService(UserProfileRepository profiles, UserRepository users, TopicService topics) {
        this.profiles = profiles;
        this.users = users;
        this.topics = topics;
    }

    @Transactional(readOnly = true)
    public ProfileResponse get(UUID userId) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("NOT_FOUND", "Profile not found."));
        return toResponse(load(userId), user.isOnboardingCompleted());
    }

    @Transactional
    public ProfileResponse update(UUID userId, ProfileRequest req) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("NOT_FOUND", "Profile not found."));
        apply(load(userId), req);
        return toResponse(load(userId), user.isOnboardingCompleted());
    }

    /** Saves the profile and marks onboarding complete; requires the fields matching depends on. */
    @Transactional
    public ProfileResponse completeOnboarding(UUID userId, ProfileRequest req) {
        if (req.country() == null || req.timeZone() == null || req.nativeLanguage() == null
                || req.englishLevel() == null || req.interests() == null || req.interests().isEmpty()) {
            throw ApiException.badRequest("ONBOARDING_INCOMPLETE", "Please complete country, time zone, native language, English level and at least one interest.");
        }
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("NOT_FOUND", "Profile not found."));
        UserProfile profile = load(userId);
        apply(profile, req);
        user.setOnboardingCompleted(true);
        return toResponse(profile, true);
    }

    @Transactional(readOnly = true)
    public UserProfile load(UUID userId) {
        return profiles.findById(userId).orElseThrow(() -> ApiException.notFound("NOT_FOUND", "Profile not found."));
    }

    private void apply(UserProfile p, ProfileRequest req) {
        p.setDisplayName(req.displayName().trim());
        p.setCountry(req.country() == null ? null : req.country().toUpperCase());
        p.setTimeZone(validTimeZone(req.timeZone()));
        p.setNativeLanguage(req.nativeLanguage());
        p.setEnglishLevel(req.englishLevel());
        List<String> goals = req.learningGoals() == null ? List.of() : req.learningGoals().stream().distinct().toList();
        if (!GOALS.containsAll(goals)) throw ApiException.badRequest("INVALID_GOAL", "One or more learning goals are not recognised.");
        List<String> interests = req.interests() == null ? List.of() : req.interests().stream().distinct().toList();
        for (String slug : interests) {
            if (!topics.isValidSlug(slug)) throw ApiException.badRequest("INVALID_INTEREST", "One or more interests are not recognised.");
        }
        p.setLearningGoals(goals);
        p.setInterests(interests);
    }

    private static String validTimeZone(String tz) {
        if (tz == null || tz.isBlank()) return null;
        try {
            return ZoneId.of(tz).getId();
        } catch (DateTimeException e) {
            throw ApiException.badRequest("INVALID_TIME_ZONE", "That time zone is not recognised.");
        }
    }

    private static ProfileResponse toResponse(UserProfile p, boolean onboardingCompleted) {
        return new ProfileResponse(p.getDisplayName(), p.getCountry(), p.getTimeZone(), p.getNativeLanguage(), p.getEnglishLevel(),
                List.copyOf(p.getLearningGoals()), List.copyOf(p.getInterests()), onboardingCompleted);
    }
}
