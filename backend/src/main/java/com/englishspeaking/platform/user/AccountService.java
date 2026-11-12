package com.englishspeaking.platform.user;

import com.englishspeaking.platform.auth.AuthDtos.*;
import com.englishspeaking.platform.auth.AuthService;
import com.englishspeaking.platform.auth.RefreshTokenRepository;
import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.calling.EndReason;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.security.RevokedSessions;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

/** Account-level operations: identity read model and irreversible deletion. */
@Service
public class AccountService {
    private final UserRepository users;
    private final UserProfileRepository profiles;
    private final UserPreferencesRepository preferences;
    private final RefreshTokenRepository refreshTokens;
    private final PasswordEncoder encoder;
    private final AuthService auth;
    private final CallService calls;
    private final RevokedSessions revoked;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public AccountService(UserRepository users, UserProfileRepository profiles, UserPreferencesRepository preferences,
                          RefreshTokenRepository refreshTokens, PasswordEncoder encoder, AuthService auth,
                          CallService calls, RevokedSessions revoked,
                          ApplicationEventPublisher events, Clock clock) {
        this.calls = calls;
        this.revoked = revoked;
        this.users = users;
        this.profiles = profiles;
        this.preferences = preferences;
        this.refreshTokens = refreshTokens;
        this.encoder = encoder;
        this.auth = auth;
        this.events = events;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public UserSummary me(UUID userId) {
        User user = users.findById(userId).filter(u -> u.getStatus() == UserStatus.ACTIVE)
                .orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again."));
        return auth.summary(user);
    }

    /**
     * Deletes personal data: profile, preferences, tokens and credentials are removed and the email is
     * anonymised. Anonymised call records are kept so partners' history stays consistent.
     */
    @Transactional
    public void deleteAccount(UUID userId, String password) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again."));
        if (!encoder.matches(password, user.getPasswordHash())) {
            throw ApiException.badRequest("WRONG_PASSWORD", "Your password is incorrect.");
        }
        // Do not leave a partner stranded in a call with a deleted account.
        calls.activeCallOf(userId).ifPresent(c -> calls.end(c.getId(), userId, EndReason.ENDED));
        refreshTokens.revokeAllForUser(userId, clock.instant());
        profiles.findById(userId).ifPresent(p -> {
            p.setDisplayName("Deleted user");
            p.setCountry(null);
            p.setTimeZone(null);
            p.setNativeLanguage(null);
            p.setLearningGoals(List.of());
            p.setInterests(List.of());
        });
        preferences.deleteById(userId);
        user.setEmail("deleted-" + userId + "@deleted.invalid");
        user.setPasswordHash(encoder.encode(UUID.randomUUID().toString()));
        user.setStatus(UserStatus.DELETED);
        revoked.block(userId); // the access token held by this browser stops working immediately
        events.publishEvent(new AccountDeletedEvent(userId));
    }

    public record AccountDeletedEvent(UUID userId) {}
}
