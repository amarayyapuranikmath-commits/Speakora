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
                                 /** Optional on input (older clients omit it): null leaves the stored value unchanged. */ Boolean allowPartnerRequests,
                                 /** Output only (ignored on input): false when this server has no email provider, so reminder emails cannot be sent. */ Boolean emailAvailable) {
        static PreferencesDto from(UserPreferences p, boolean emailAvailable) {
            return new PreferencesDto(p.isMatchSimilarLevel(), p.isShowCountry(), p.isShowLevel(), p.isNotifyEmailReminders(), p.isAiCoachConsent(), p.isAllowPartnerRequests(), emailAvailable);
        }
    }

    private final UserPreferencesRepository repo;
    private final com.englishspeaking.platform.notification.MailService mail;

    public PreferencesController(UserPreferencesRepository repo, com.englishspeaking.platform.notification.MailService mail) {
        this.repo = repo;
        this.mail = mail;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public PreferencesDto get(@AuthenticationPrincipal AuthPrincipal me) { return PreferencesDto.from(load(me), !mail.cannotSendEmail()); }

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
        return PreferencesDto.from(p, !mail.cannotSendEmail());
    }

    private UserPreferences load(AuthPrincipal me) {
        return repo.findById(me.userId()).orElseThrow(() -> ApiException.notFound("NOT_FOUND", "Preferences not found."));
    }
}
