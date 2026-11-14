package com.englishspeaking.platform.user;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.security.RateLimiter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Duration;
import java.time.LocalDate;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AdminClaimServiceTest {
    private static final String TOKEN = "k7Qm2VxR9bTn4LpW8sYc3HdZ6fJe1AuG0oXi5NvB"; // 40 chars
    @Mock UserRepository users;
    @Mock RateLimiter limiter;
    User user;

    @BeforeEach
    void setUp() {
        user = new User("me@example.com", "hash", LocalDate.of(1990, 1, 1));
        when(users.findById(user.getId())).thenReturn(Optional.of(user));
        when(users.existsByRole("ADMIN")).thenReturn(false);
        when(limiter.tryAcquire(anyString(), anyInt(), any(Duration.class))).thenReturn(true);
    }

    private AdminClaimService service(String token) { return new AdminClaimService(users, limiter, token); }

    @Test
    void theRightTokenMakesTheSignedInUserTheFirstAdmin() {
        service(TOKEN).claim(user.getId(), TOKEN);
        assertThat(user.isAdmin()).isTrue();
    }

    @Test
    void aWrongOrMissingTokenGrantsNothing() {
        for (String bad : new String[] {"wrong", TOKEN + "x", TOKEN.substring(1), "", null}) {
            assertThatThrownBy(() -> service(TOKEN).claim(user.getId(), bad)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(403));
        }
        assertThat(user.isAdmin()).isFalse();
    }

    @Test
    void withNoConfiguredTokenTheEndpointDoesNotExistForAnyone() {
        for (String configured : new String[] {"", "   ", null}) {
            assertThat(service(configured).enabled()).isFalse();
            assertThatThrownBy(() -> service(configured).claim(user.getId(), "anything")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(404));
            assertThatThrownBy(() -> service(configured).claim(user.getId(), configured)).isInstanceOf(ApiException.class);
        }
        assertThat(user.isAdmin()).isFalse();
    }

    @Test
    void aTooShortConfiguredTokenSwitchesTheMechanismOffInsteadOfAcceptingAWeakSecret() {
        AdminClaimService weak = service("short-secret");
        assertThat(weak.enabled()).isFalse();
        assertThatThrownBy(() -> weak.claim(user.getId(), "short-secret")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(404));
        assertThat(user.isAdmin()).isFalse();
    }

    @Test
    void onceAnAdminExistsEvenTheRightTokenCannotCreateAnother() {
        when(users.existsByRole("ADMIN")).thenReturn(true);
        assertThatThrownBy(() -> service(TOKEN).claim(user.getId(), TOKEN)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.status().value()).isEqualTo(409);
            assertThat(e.code()).isEqualTo("ADMIN_EXISTS");
        });
        assertThat(user.isAdmin()).isFalse();
    }

    @Test
    void aSuspendedAccountCannotClaim() {
        user.setStatus(UserStatus.SUSPENDED);
        assertThatThrownBy(() -> service(TOKEN).claim(user.getId(), TOKEN)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(403));
        assertThat(user.isAdmin()).isFalse();
    }

    @Test
    void guessingIsRateLimitedPerAccountAndForTheWholeServerBeforeTheTokenIsEvenChecked() {
        when(limiter.tryAcquire(anyString(), anyInt(), any(Duration.class))).thenReturn(false);
        assertThatThrownBy(() -> service(TOKEN).claim(user.getId(), TOKEN)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(429));
        assertThat(user.isAdmin()).isFalse();
        verify(users, never()).existsByRole(anyString());
    }

    @Test
    void registeringWithAnyEmailNeverGrantsAnAdminRole() {
        // A new account is a plain USER whatever its address (even one listed in ADMIN_EMAILS, which also needs a verified address).
        assertThat(new User("owner@example.com", "hash", LocalDate.of(1990, 1, 1)).getRole()).isEqualTo("USER");
    }
}
