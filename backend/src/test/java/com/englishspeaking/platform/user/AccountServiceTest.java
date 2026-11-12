package com.englishspeaking.platform.user;

import com.englishspeaking.platform.TestSupport;
import com.englishspeaking.platform.auth.AuthService;
import com.englishspeaking.platform.auth.RefreshTokenRepository;
import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.calling.CallSession;
import com.englishspeaking.platform.calling.EndReason;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AccountServiceTest {
    @Mock UserRepository users;
    @Mock UserProfileRepository profiles;
    @Mock UserPreferencesRepository preferences;
    @Mock RefreshTokenRepository refreshTokens;
    @Mock AuthService auth;
    @Mock CallService calls;
    @Mock com.englishspeaking.platform.security.RevokedSessions revoked;
    @Mock ApplicationEventPublisher events;

    final PasswordEncoder encoder = new BCryptPasswordEncoder(4);
    final TestSupport.MutableClock clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z"));
    AccountService service;
    User user;
    UserProfile profile;

    @BeforeEach
    void setUp() {
        service = new AccountService(users, profiles, preferences, refreshTokens, encoder, auth, calls, revoked, events, clock);
        user = new User("ana@example.com", encoder.encode("Passw0rdOK"), LocalDate.of(1990, 1, 1));
        profile = new UserProfile(user.getId(), "Ana");
        profile.setCountry("ES");
        profile.setInterests(List.of("travel"));
        when(users.findById(user.getId())).thenReturn(Optional.of(user));
        when(profiles.findById(user.getId())).thenReturn(Optional.of(profile));
    }

    @Test
    void deletionRequiresThePassword() {
        assertThatThrownBy(() -> service.deleteAccount(user.getId(), "wrong-password1"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("WRONG_PASSWORD"));
        assertThat(user.getStatus()).isEqualTo(UserStatus.ACTIVE);
    }

    @Test
    void deletionRemovesPersonalDataRevokesSessionsAndEndsTheActiveCall() {
        CallSession active = new CallSession(UUID.randomUUID(), null, clock.instant());
        when(calls.activeCallOf(user.getId())).thenReturn(Optional.of(active));

        service.deleteAccount(user.getId(), "Passw0rdOK");

        verify(calls).end(active.getId(), user.getId(), EndReason.ENDED);
        verify(refreshTokens).revokeAllForUser(eq(user.getId()), any());
        verify(revoked).block(user.getId());
        verify(preferences).deleteById(user.getId());
        assertThat(user.getStatus()).isEqualTo(UserStatus.DELETED);
        assertThat(user.getEmail()).endsWith("@deleted.invalid").doesNotContain("ana");
        assertThat(encoder.matches("Passw0rdOK", user.getPasswordHash())).isFalse();
        assertThat(profile.getDisplayName()).isEqualTo("Deleted user");
        assertThat(profile.getCountry()).isNull();
        assertThat(profile.getInterests()).isEmpty();
        verify(events).publishEvent(new AccountService.AccountDeletedEvent(user.getId()));
    }

    @Test
    void deletedAccountsCannotReadTheirIdentity() {
        user.setStatus(UserStatus.DELETED);
        assertThatThrownBy(() -> service.me(user.getId())).isInstanceOf(ApiException.class);
    }
}
