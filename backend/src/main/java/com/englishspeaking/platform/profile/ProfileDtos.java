package com.englishspeaking.platform.profile;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

public final class ProfileDtos {
    private ProfileDtos() {}

    public record ProfileRequest(
            @NotBlank @Size(min = 2, max = 40) String displayName,
            @Pattern(regexp = "^[A-Za-z]{2}$", message = "Use a 2-letter country code.") String country,
            @Size(max = 64) String timeZone,
            @Pattern(regexp = "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$", message = "Use a language code such as 'es' or 'pt-BR'.") String nativeLanguage,
            EnglishLevel englishLevel,
            @Size(max = 8) List<@Size(max = 30) String> learningGoals,
            @Size(max = 10) List<@Size(max = 50) String> interests) {}

    public record ProfileResponse(String displayName, String country, String timeZone, String nativeLanguage,
                                  EnglishLevel englishLevel, List<String> learningGoals, List<String> interests,
                                  boolean onboardingCompleted) {}
}
