package com.englishspeaking.platform.preferences;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.security.AuthPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/preferences")
public class PreferencesController {
    public record PreferencesDto(@NotNull Boolean matchSimilarLevel, @NotNull Boolean showCountry, @NotNull Boolean showLevel,
                                 @NotNull Boolean notifyEmailReminders, @NotNull Boolean aiCoachConsent,
                                 /** Optional on input (older clients omit it): null leaves the stored value unchanged. */ Boolean allowPartnerRequests) {
        static PreferencesDto from(UserPreferences p) {
            return new PreferencesDto(p.isMatchSimilarLevel(), p.isShowCountry(), p.isShowLevel(), p.isNotifyEmailReminders(), p.isAiCoachConsent(), p.isAllowPartnerRequests());
        }
    }

    private final UserPreferencesRepository repo;

    public PreferencesController(UserPreferencesRepository repo) { this.repo = repo; }

    @GetMapping
    @Transactional(readOnly = true)
    public PreferencesDto get(@AuthenticationPrincipal AuthPrincipal me) { return PreferencesDto.from(load(me)); }

    @PutMapping
    @Transactional
    public PreferencesDto update(@AuthenticationPrincipal AuthPrincipal me, @Valid @RequestBody PreferencesDto dto) {
        UserPreferences p = load(me);
        p.setMatchSimilarLevel(dto.matchSimilarLevel());
        p.setShowCountry(dto.showCountry());
        p.setShowLevel(dto.showLevel());
        p.setNotifyEmailReminders(dto.notifyEmailReminders());
        p.setAiCoachConsent(dto.aiCoachConsent());
        if (dto.allowPartnerRequests() != null) p.setAllowPartnerRequests(dto.allowPartnerRequests());
        return PreferencesDto.from(p);
    }

    private UserPreferences load(AuthPrincipal me) {
        return repo.findById(me.userId()).orElseThrow(() -> ApiException.notFound("NOT_FOUND", "Preferences not found."));
    }
}
