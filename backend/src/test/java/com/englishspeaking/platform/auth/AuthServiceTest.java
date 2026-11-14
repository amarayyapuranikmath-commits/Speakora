package com.englishspeaking.platform.auth;

import com.englishspeaking.platform.TestSupport;
import com.englishspeaking.platform.auth.AuthDtos.*;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.notification.MailService;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.security.JwtService;
import com.englishspeaking.platform.statistics.UserStatisticsRepository;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import com.englishspeaking.platform.user.UserStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AuthServiceTest {
    @Mock UserRepository users;
    @Mock UserProfileRepository profiles;
    @Mock UserPreferencesRepository preferences;
    @Mock UserStatisticsRepository statistics;
    @Mock RefreshTokenRepository refreshTokens;
    @Mock EmailVerificationTokenRepository verificationTokens;
    @Mock PasswordResetTokenRepository resetTokens;
    @Mock MailService mail;
    @Mock com.englishspeaking.platform.user.AdminBootstrap adminBootstrap;
    @Mock com.englishspeaking.platform.security.RateLimiter limiter;

    final PasswordEncoder encoder = new BCryptPasswordEncoder(4);
    final TestSupport.MutableClock clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z"));
    AuthService service;

    @BeforeEach
    void setUp() {
        service = new AuthService(users, profiles, preferences, statistics, refreshTokens, verificationTokens, resetTokens,
                encoder, new JwtService(TestSupport.props(), clock), mail, TestSupport.props(), clock, adminBootstrap, limiter, 400);
        when(users.save(any(User.class))).thenAnswer(i -> i.getArgument(0));
        when(limiter.tryAcquire(anyString(), anyInt(), any(Duration.class))).thenReturn(true); // within every limit unless a test says otherwise
        when(verificationTokens.save(any(EmailVerificationToken.class))).thenAnswer(i -> i.getArgument(0));
        when(resetTokens.save(any(PasswordResetToken.class))).thenAnswer(i -> i.getArgument(0));
    }

    private RegisterRequest register(LocalDate dob) {
        return new RegisterRequest("New.User@Example.com ", "Passw0rdOK", "  Ana ", dob);
    }

    @Test
    void registerCreatesAccountProfileAndSessionWithoutStoringPlainSecrets() {
        when(users.existsByEmail(anyString())).thenReturn(false);

        AuthResult result = service.register(register(LocalDate.of(1990, 5, 1)), "JUnit");

        ArgumentCaptor<User> user = ArgumentCaptor.forClass(User.class);
        verify(users).save(user.capture());
        assertThat(user.getValue().getEmail()).isEqualTo("new.user@example.com");
        assertThat(user.getValue().getPasswordHash()).isNotEqualTo("Passw0rdOK").startsWith("$2");

        ArgumentCaptor<UserProfile> profile = ArgumentCaptor.forClass(UserProfile.class);
        verify(profiles).save(profile.capture());
        assertThat(profile.getValue().getDisplayName()).isEqualTo("Ana");

        ArgumentCaptor<RefreshToken> stored = ArgumentCaptor.forClass(RefreshToken.class);
        verify(refreshTokens).save(stored.capture());
        assertThat(result.refreshToken()).isNotBlank();
        assertThat(result.accessToken()).isNotBlank();
        verify(refreshTokens).save(argThat(t -> t.getUserId().equals(user.getValue().getId())));
        verifyNoInteractions(mail); // signing up sends no verification email
    }

    @Test
    void registerRejectsUnder18() {
        assertThatThrownBy(() -> service.register(register(LocalDate.of(2010, 1, 1)), "UA"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("UNDERAGE"));
        verify(users, never()).save(any());
    }

    @Test
    void registerAcceptsExactly18thBirthday() {
        when(users.existsByEmail(anyString())).thenReturn(false);
        assertThat(service.register(register(LocalDate.of(2008, 11, 9)), "UA")).isNotNull();
    }

    @Test
    void registerRejectsImplausibleBirthDates() {
        assertThatThrownBy(() -> service.register(register(LocalDate.of(1850, 1, 1)), "UA"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("INVALID_DATE_OF_BIRTH"));
    }

    @Test
    void registerRejectsDuplicateEmail() {
        when(users.existsByEmail("new.user@example.com")).thenReturn(true);
        assertThatThrownBy(() -> service.register(register(LocalDate.of(1990, 5, 1)), "UA"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("EMAIL_TAKEN"));
    }

    private User existingUser(UserStatus status) {
        User u = new User("a@b.com", encoder.encode("Passw0rdOK"), LocalDate.of(1990, 1, 1));
        u.setStatus(status);
        when(users.findByEmail("a@b.com")).thenReturn(Optional.of(u));
        when(users.findById(u.getId())).thenReturn(Optional.of(u));
        return u;
    }

    @Test
    void loginSucceedsWithCorrectPassword() {
        existingUser(UserStatus.ACTIVE);
        assertThat(service.login(new LoginRequest("A@B.com", "Passw0rdOK"), "UA").accessToken()).isNotBlank();
    }

    @Test
    void loginFailuresAreIndistinguishable() {
        existingUser(UserStatus.ACTIVE);
        for (LoginRequest bad : new LoginRequest[]{new LoginRequest("a@b.com", "wrong-password1"), new LoginRequest("nobody@b.com", "Passw0rdOK")}) {
            assertThatThrownBy(() -> service.login(bad, "UA"))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("INVALID_CREDENTIALS"));
        }
    }

    @Test
    void suspendedUserCannotLogIn() {
        existingUser(UserStatus.SUSPENDED);
        assertThatThrownBy(() -> service.login(new LoginRequest("a@b.com", "Passw0rdOK"), "UA"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("ACCOUNT_SUSPENDED"));
    }

    @Test
    void deletedUserCannotLogIn() {
        existingUser(UserStatus.DELETED);
        assertThatThrownBy(() -> service.login(new LoginRequest("a@b.com", "Passw0rdOK"), "UA"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("INVALID_CREDENTIALS"));
    }

    private RefreshToken storedToken(User user, String raw, UUID family, Instant revokedAt, Duration validFor) {
        RefreshToken t = new RefreshToken(user.getId(), TokenGenerator.hash(raw), family, clock.instant().plus(validFor), "UA");
        if (revokedAt != null) t.revoke(revokedAt);
        when(refreshTokens.findByTokenHash(TokenGenerator.hash(raw))).thenReturn(Optional.of(t));
        return t;
    }

    @Test
    void refreshRotatesTokenWithinTheSameFamily() {
        User user = existingUser(UserStatus.ACTIVE);
        UUID family = UUID.randomUUID();
        RefreshToken old = storedToken(user, "old-token", family, null, Duration.ofDays(1));

        AuthResult result = service.refresh("old-token", "UA");

        assertThat(old.getRevokedAt()).isNotNull();
        assertThat(result.refreshToken()).isNotEqualTo("old-token");
        verify(refreshTokens).save(argThat(t -> t.getFamilyId().equals(family)));
    }

    @Test
    void reusingAnOldRefreshTokenRevokesTheWholeFamily() {
        User user = existingUser(UserStatus.ACTIVE);
        UUID family = UUID.randomUUID();
        storedToken(user, "stolen", family, clock.instant().minusSeconds(120), Duration.ofDays(1));

        assertThatThrownBy(() -> service.refresh("stolen", "UA")).isInstanceOf(ApiException.class);
        verify(refreshTokens).revokeFamily(eq(family), any());
    }

    @Test
    void immediateDoubleRefreshIsTreatedAsARaceNotTheft() {
        User user = existingUser(UserStatus.ACTIVE);
        UUID family = UUID.randomUUID();
        storedToken(user, "tab-race", family, clock.instant().minusSeconds(2), Duration.ofDays(1));

        assertThatThrownBy(() -> service.refresh("tab-race", "UA")).isInstanceOf(ApiException.class);
        verify(refreshTokens, never()).revokeFamily(any(), any());
    }

    @Test
    void expiredUnknownAndMissingRefreshTokensAreRejected() {
        User user = existingUser(UserStatus.ACTIVE);
        storedToken(user, "expired", UUID.randomUUID(), null, Duration.ofSeconds(-1));
        assertThatThrownBy(() -> service.refresh("expired", "UA")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.refresh("unknown", "UA")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.refresh(null, "UA")).isInstanceOf(ApiException.class);
    }

    @Test
    void refreshForSuspendedUserRevokesFamily() {
        User user = existingUser(UserStatus.SUSPENDED);
        UUID family = UUID.randomUUID();
        storedToken(user, "tok", family, null, Duration.ofDays(1));
        assertThatThrownBy(() -> service.refresh("tok", "UA")).isInstanceOf(ApiException.class);
        verify(refreshTokens).revokeFamily(eq(family), any());
    }

    @Test
    void logoutRevokesFamilyAndIgnoresMissingToken() {
        User user = existingUser(UserStatus.ACTIVE);
        UUID family = UUID.randomUUID();
        storedToken(user, "tok", family, null, Duration.ofDays(1));
        service.logout("tok");
        service.logout(null);
        verify(refreshTokens).revokeFamily(eq(family), any());
    }

    @Test
    void forgotPasswordDoesNotRevealWhetherAccountExists() {
        when(users.findByEmail("ghost@b.com")).thenReturn(Optional.empty());
        service.forgotPassword("ghost@b.com");
        verify(mail, never()).sendPasswordResetEmail(anyString(), anyString(), anyString());

        existingUser(UserStatus.ACTIVE);
        service.forgotPassword("a@b.com");
        verify(mail).sendPasswordResetEmail(eq("a@b.com"), anyString(), anyString());
    }

    @Test
    void withNoMailProviderForgotPasswordSaysSoToEveryoneAndNeverPretendsAnEmailWasSent() {
        when(mail.cannotSendEmail()).thenReturn(true);
        existingUser(UserStatus.ACTIVE);
        for (String address : new String[] {"a@b.com", "ghost@b.com"}) { // an existing and an unknown account get the same answer
            assertThatThrownBy(() -> service.forgotPassword(address)).isInstanceOfSatisfying(ApiException.class, e -> {
                assertThat(e.code()).isEqualTo("EMAIL_SEND_FAILED");
                assertThat(e.status().value()).isEqualTo(503);
                assertThat(e.getMessage()).contains("Email is not available on this server");
            });
        }
        verify(mail, never()).sendPasswordResetEmail(anyString(), anyString(), anyString());
        verify(resetTokens, never()).save(any());
    }

    @Test
    void resetPasswordChangesHashConsumesTokenAndRevokesSessions() {
        User user = existingUser(UserStatus.ACTIVE);
        PasswordResetToken token = new PasswordResetToken(user.getId(), TokenGenerator.hash("reset"), clock.instant().plusSeconds(600));
        when(resetTokens.findByTokenHash(TokenGenerator.hash("reset"))).thenReturn(Optional.of(token));

        service.resetPassword("reset", "BrandNewPass1");

        assertThat(encoder.matches("BrandNewPass1", user.getPasswordHash())).isTrue();
        assertThat(token.isUsable(clock.instant())).isFalse();
        verify(refreshTokens).revokeAllForUser(eq(user.getId()), any());
        assertThatThrownBy(() -> service.resetPassword("reset", "AnotherPass2")).isInstanceOf(ApiException.class);
    }

    @Test
    void changePasswordRequiresCurrentPassword() {
        User user = existingUser(UserStatus.ACTIVE);
        assertThatThrownBy(() -> service.changePassword(user.getId(), new ChangePasswordRequest("nope-nope-1", "BrandNewPass1"), "UA"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("WRONG_PASSWORD"));
        service.changePassword(user.getId(), new ChangePasswordRequest("Passw0rdOK", "BrandNewPass1"), "UA");
        assertThat(encoder.matches("BrandNewPass1", user.getPasswordHash())).isTrue();
        verify(refreshTokens).revokeAllForUser(eq(user.getId()), any());
    }

    @Test
    void verifyEmailMarksUserVerifiedOnce() {
        User user = existingUser(UserStatus.ACTIVE);
        EmailVerificationToken token = new EmailVerificationToken(user.getId(), TokenGenerator.hash("v"), clock.instant().plusSeconds(600));
        when(verificationTokens.findByTokenHash(TokenGenerator.hash("v"))).thenReturn(Optional.of(token));
        service.verifyEmail("v");
        assertThat(user.isEmailVerified()).isTrue();
        assertThatThrownBy(() -> service.verifyEmail("v")).isInstanceOf(ApiException.class);
    }

    // ------------------------------------------------------------------ six-digit codes (mobile app)

    private PasswordResetToken resetCodeToken(User user, String code, long ttlSeconds) {
        PasswordResetToken t = new PasswordResetToken(user.getId(), TokenGenerator.hash("link-" + code), clock.instant().plusSeconds(ttlSeconds), TokenGenerator.hashCode(user.getId(), code));
        when(resetTokens.findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(user.getId())).thenReturn(Optional.of(t));
        return t;
    }

    @Test
    void forgotPasswordEmailsALinkAndASixDigitCodeThatOnlyWorksForThatAccount() {
        User user = existingUser(UserStatus.ACTIVE);
        when(resetTokens.findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(user.getId())).thenReturn(Optional.empty());
        service.forgotPassword("a@b.com");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        verify(mail).sendPasswordResetEmail(eq("a@b.com"), anyString(), code.capture());
        assertThat(code.getValue()).matches("[0-9]{6}");
        ArgumentCaptor<PasswordResetToken> saved = ArgumentCaptor.forClass(PasswordResetToken.class);
        verify(resetTokens).save(saved.capture());
        assertThat(saved.getValue().getCodeHash()).isEqualTo(TokenGenerator.hashCode(user.getId(), code.getValue()));
        assertThat(saved.getValue().getCodeHash()).as("the code itself is never stored").doesNotContain(code.getValue());
        assertThat(TokenGenerator.hashCode(UUID.randomUUID(), code.getValue())).as("bound to the account").isNotEqualTo(saved.getValue().getCodeHash());
    }

    @Test
    void askingForAnotherResetCodeSendsItAtOnceEveryTimeAndRetiresTheEarlierOnes() {
        User user = existingUser(UserStatus.ACTIVE);
        PasswordResetToken recent = resetCodeToken(user, "111111", 1800);
        recent.setCreatedAt(clock.instant().minusSeconds(5)); // five seconds ago: there is no waiting time any more
        service.forgotPassword("a@b.com");
        var order = inOrder(mail, resetTokens);
        order.verify(mail).sendPasswordResetEmail(eq("a@b.com"), anyString(), matches("[0-9]{6}"));
        order.verify(resetTokens).retireOthers(eq(user.getId()), any(), any()); // only after the new email was accepted
        service.forgotPassword("a@b.com");
        verify(mail, times(2)).sendPasswordResetEmail(eq("a@b.com"), anyString(), anyString());
    }

    @Test
    void theNewResetCodeIsStrictlyNewerThanTheLastSoItIsAlwaysTheOneThatIsChecked() {
        User user = existingUser(UserStatus.ACTIVE);
        PasswordResetToken justNow = resetCodeToken(user, "111111", 1800);
        justNow.setCreatedAt(clock.instant()); // issued in the very same instant
        service.forgotPassword("a@b.com");
        ArgumentCaptor<PasswordResetToken> saved = ArgumentCaptor.forClass(PasswordResetToken.class);
        verify(resetTokens).save(saved.capture());
        assertThat(saved.getValue().getCreatedAt()).isAfter(justNow.getCreatedAt());
    }

    @Test
    void whenTheResetEmailCannotBeSentThePersonIsToldAndTheEarlierCodeKeepsWorking() {
        existingUser(UserStatus.ACTIVE);
        doThrow(new com.englishspeaking.platform.notification.MailDeliveryException(com.englishspeaking.platform.notification.MailDeliveryException.Kind.LOGIN_REFUSED, "535", null))
                .when(mail).sendPasswordResetEmail(anyString(), anyString(), anyString());
        assertThatThrownBy(() -> service.forgotPassword("a@b.com")).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.code()).isEqualTo("EMAIL_SEND_FAILED");
            assertThat(e.status().value()).isEqualTo(503);
            assertThat(e.getMessage()).contains("refused to accept it").contains("not yours").doesNotContain("535").doesNotContain("password");
        });
        verify(resetTokens, never()).retireOthers(any(), any(), any());
    }

    @Test
    void theLimitOnCodesIsCountedPerAddressWhetherOrNotAnAccountExistsSoItRevealsNothing() {
        String key = "otp:reset:" + java.util.HexFormat.of().formatHex(sha("ghost@b.com"));
        when(limiter.tryAcquire(eq(key), eq(AuthService.MAX_CODES_PER_WINDOW), eq(AuthService.CODE_WINDOW))).thenReturn(false);
        when(users.findByEmail("ghost@b.com")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.forgotPassword("  Ghost@B.com ")).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.code()).isEqualTo("TOO_MANY_CODES");
            assertThat(e.status().value()).isEqualTo(429);
            assertThat(e.retryAfterSeconds()).isEqualTo(900);
            assertThat(e.getMessage()).contains("about 15 minutes").contains("newest code you received still works");
        });
        verify(mail, never()).sendPasswordResetEmail(anyString(), anyString(), anyString());
    }

    private static byte[] sha(String text) {
        try { return java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    @Test
    void theCorrectCodeSetsANewPasswordOnceAndSignsEverythingOut() {
        User user = existingUser(UserStatus.ACTIVE);
        PasswordResetToken token = resetCodeToken(user, "482913", 1800);

        service.resetPasswordWithCode("A@B.com ", "482913", "BrandNewPass1");

        assertThat(encoder.matches("BrandNewPass1", user.getPasswordHash())).isTrue();
        assertThat(token.isUsable(clock.instant())).isFalse();
        verify(refreshTokens).revokeAllForUser(eq(user.getId()), any());
        assertThatThrownBy(() -> service.resetPasswordWithCode("a@b.com", "482913", "AnotherPass2"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("INVALID_CODE"));
    }

    @Test
    void wrongCodesAreCountedAndTheFifthKillsTheCodeEvenIfTheNextGuessIsRight() {
        User user = existingUser(UserStatus.ACTIVE);
        PasswordResetToken token = resetCodeToken(user, "482913", 1800);
        for (int i = 1; i <= 4; i++) {
            assertThatThrownBy(() -> service.resetPasswordWithCode("a@b.com", "000000", "BrandNewPass1"))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("not right"));
        }
        assertThatThrownBy(() -> service.resetPasswordWithCode("a@b.com", "000000", "BrandNewPass1"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("Too many wrong codes"));
        assertThat(token.isUsable(clock.instant())).isFalse();
        assertThatThrownBy(() -> service.resetPasswordWithCode("a@b.com", "482913", "BrandNewPass1")).isInstanceOf(ApiException.class);
        assertThat(encoder.matches("BrandNewPass1", user.getPasswordHash())).as("the password never changed").isFalse();
    }

    @Test
    void anExpiredCodeAndAnUnknownEmailFailTheSameWay() {
        User user = existingUser(UserStatus.ACTIVE);
        resetCodeToken(user, "482913", -5);
        when(users.findByEmail("ghost@b.com")).thenReturn(Optional.empty());
        ApiException expired = org.junit.jupiter.api.Assertions.assertThrows(ApiException.class, () -> service.resetPasswordWithCode("a@b.com", "482913", "BrandNewPass1"));
        ApiException unknown = org.junit.jupiter.api.Assertions.assertThrows(ApiException.class, () -> service.resetPasswordWithCode("ghost@b.com", "482913", "BrandNewPass1"));
        assertThat(expired.code()).isEqualTo("INVALID_CODE");
        assertThat(unknown.code()).isEqualTo(expired.code());
        assertThat(unknown.getMessage()).isEqualTo(expired.getMessage());
    }

    @Test
    void theEmailCodeVerifiesTheSignedInAccountAndWrongOnesDoNot() {
        User user = existingUser(UserStatus.ACTIVE);
        EmailVerificationToken token = new EmailVerificationToken(user.getId(), TokenGenerator.hash("v"), clock.instant().plusSeconds(1800), TokenGenerator.hashCode(user.getId(), "246810"));
        when(verificationTokens.findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(user.getId())).thenReturn(Optional.of(token));

        assertThatThrownBy(() -> service.verifyEmailCode(user.getId(), "135790"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("INVALID_CODE"));
        assertThat(user.isEmailVerified()).isFalse();

        service.verifyEmailCode(user.getId(), "246810");
        assertThat(user.isEmailVerified()).isTrue();
        assertThatThrownBy(() -> service.verifyEmailCode(user.getId(), "246810")).isInstanceOf(ApiException.class); // single use
    }

    @Test
    void resendingTheVerificationEmailSendsAFreshCodeAtOnceEvenSecondsAfterTheLastOne() {
        User user = existingUser(UserStatus.ACTIVE);
        EmailVerificationToken last = new EmailVerificationToken(user.getId(), TokenGenerator.hash("v"), clock.instant().plusSeconds(1800), TokenGenerator.hashCode(user.getId(), "246810"));
        last.setCreatedAt(clock.instant().minusSeconds(3));
        when(verificationTokens.findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(user.getId())).thenReturn(Optional.of(last));

        service.resendVerification(user.getId());

        var order = inOrder(mail, verificationTokens);
        order.verify(mail).sendVerificationEmail(eq("a@b.com"), anyString(), matches("[0-9]{6}"));
        order.verify(verificationTokens).retireOthers(eq(user.getId()), any(), any()); // earlier codes and links stop working once the new email is accepted
        ArgumentCaptor<EmailVerificationToken> saved = ArgumentCaptor.forClass(EmailVerificationToken.class);
        verify(verificationTokens).save(saved.capture());
        assertThat(saved.getValue().getCreatedAt()).as("always newer than the code it replaces").isAfter(last.getCreatedAt());
    }

    @Test
    void aResendThatCannotBeSentIsReportedClearlyAndLeavesTheEarlierCodeWorking() {
        User user = existingUser(UserStatus.ACTIVE);
        doThrow(new com.englishspeaking.platform.notification.MailDeliveryException(com.englishspeaking.platform.notification.MailDeliveryException.Kind.TIMEOUT, "timed out", null))
                .when(mail).sendVerificationEmail(anyString(), anyString(), anyString());
        assertThatThrownBy(() -> service.resendVerification(user.getId())).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.code()).isEqualTo("EMAIL_SEND_FAILED");
            assertThat(e.status().value()).isEqualTo(503);
            assertThat(e.getMessage()).isEqualTo("The email service did not answer in time. Please try again in a moment.");
        });
        verify(verificationTokens, never()).retireOthers(any(), any(), any());
    }

    @Test
    void everyKindOfSendFailureHasItsOwnClearMessageThatNeverShowsACredentialOrAServerDetail() {
        var kinds = com.englishspeaking.platform.notification.MailDeliveryException.Kind.values();
        var messages = new java.util.HashSet<String>();
        for (var kind : kinds) {
            String m = AuthService.describeFailure(kind);
            assertThat(m).isNotBlank().doesNotContain("smtp").doesNotContain("535").doesNotContain("gmail").doesNotContainIgnoringCase("app password");
            messages.add(m);
        }
        assertThat(messages.size()).as("distinct messages for distinct problems").isGreaterThanOrEqualTo(5);
        assertThat(AuthService.describeFailure(com.englishspeaking.platform.notification.MailDeliveryException.Kind.RECIPIENT_REFUSED)).contains("check that it is typed correctly");
    }

    @Test
    void tooManyCodesForOneAccountAreRefusedWithAClearMessageAndNothingIsSent() {
        User user = existingUser(UserStatus.ACTIVE);
        when(limiter.tryAcquire(eq("otp:verify:" + user.getId()), eq(6), eq(Duration.ofMinutes(15)))).thenReturn(false);
        assertThatThrownBy(() -> service.resendVerification(user.getId())).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.code()).isEqualTo("TOO_MANY_CODES");
            assertThat(e.status().value()).isEqualTo(429);
            assertThat(e.retryAfterSeconds()).isEqualTo(900);
        });
        verifyNoInteractions(mail);
    }

    @Test
    void theDailyCapThatProtectsTheMailProviderLimitIsExplainedAndNothingIsSent() {
        User user = existingUser(UserStatus.ACTIVE);
        when(limiter.tryAcquire(eq("otp:day"), eq(400), eq(Duration.ofDays(1)))).thenReturn(false);
        assertThatThrownBy(() -> service.resendVerification(user.getId())).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.code()).isEqualTo("EMAIL_DAILY_LIMIT");
            assertThat(e.status().value()).isEqualTo(429);
            assertThat(e.getMessage()).contains("today's limit").contains("try again tomorrow");
        });
        verifyNoInteractions(mail);
    }

    @Test
    void aDailyCapOfZeroSwitchesTheCapOffAndNeverTouchesTheSharedCounter() {
        var uncapped = new AuthService(users, profiles, preferences, statistics, refreshTokens, verificationTokens, resetTokens,
                encoder, new JwtService(TestSupport.props(), clock), mail, TestSupport.props(), clock, adminBootstrap, limiter, 0);
        User user = existingUser(UserStatus.ACTIVE);
        uncapped.resendVerification(user.getId());
        verify(limiter, never()).tryAcquire(eq("otp:day"), anyInt(), any(Duration.class));
        verify(mail).sendVerificationEmail(eq("a@b.com"), anyString(), anyString());
    }

    @Test
    void signingUpSendsNoEmailAndStillGivesASessionEvenWhenTheMailServiceIsDown() {
        when(users.existsByEmail(anyString())).thenReturn(false);
        // A broken mail service must not matter: registration never calls it.
        lenient().doThrow(new com.englishspeaking.platform.notification.MailDeliveryException(com.englishspeaking.platform.notification.MailDeliveryException.Kind.CONNECTION, "refused", null))
                .when(mail).sendVerificationEmail(anyString(), anyString(), anyString());
        AuthResult result = service.register(register(LocalDate.of(1990, 5, 1)), "JUnit");
        assertThat(result.user().email()).isEqualTo("new.user@example.com");
        assertThat(result.accessToken()).isNotBlank();
        assertThat(result.verificationEmailProblem()).isNull();
        verify(users).save(any(User.class));
        verifyNoInteractions(mail);
        verifyNoInteractions(verificationTokens);
    }

    @Test
    void anExistingUnverifiedAccountCanLogInWithItsPasswordAndAWrongPasswordIsStillRefused() {
        User user = existingUser(UserStatus.ACTIVE);
        assertThat(user.isEmailVerified()).isFalse();
        assertThat(service.login(new LoginRequest("a@b.com", "Passw0rdOK"), "UA").accessToken()).isNotBlank();
        assertThatThrownBy(() -> service.login(new LoginRequest("a@b.com", "wrong-password"), "UA"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("INVALID_CREDENTIALS"));
    }

    @Test
    void aCodeStopsWorkingAfterThirtyMinutesEvenThoughTheLinkInTheSameEmailLivesLonger() {
        User user = existingUser(UserStatus.ACTIVE);
        EmailVerificationToken token = new EmailVerificationToken(user.getId(), TokenGenerator.hash("v"), clock.instant().plusSeconds(86_400), TokenGenerator.hashCode(user.getId(), "246810"));
        token.setCreatedAt(clock.instant().minusSeconds(31 * 60));
        when(verificationTokens.findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(user.getId())).thenReturn(Optional.of(token));
        assertThatThrownBy(() -> service.verifyEmailCode(user.getId(), "246810"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("expired"));
        assertThat(user.isEmailVerified()).isFalse();
        // the link in the same email is still good
        when(verificationTokens.findByTokenHash(TokenGenerator.hash("v"))).thenReturn(Optional.of(token));
        service.verifyEmail("v");
        assertThat(user.isEmailVerified()).isTrue();

        User other = existingUser(UserStatus.ACTIVE);
        PasswordResetToken reset = new PasswordResetToken(other.getId(), TokenGenerator.hash("r"), clock.instant().plusSeconds(3600), TokenGenerator.hashCode(other.getId(), "135790"));
        reset.setCreatedAt(clock.instant().minusSeconds(29 * 60));
        when(resetTokens.findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(other.getId())).thenReturn(Optional.of(reset));
        service.resetPasswordWithCode("a@b.com", "135790", "BrandNewPass1"); // 29 minutes: still fine
        assertThat(encoder.matches("BrandNewPass1", other.getPasswordHash())).isTrue();

        PasswordResetToken old = new PasswordResetToken(other.getId(), TokenGenerator.hash("r2"), clock.instant().plusSeconds(3600), TokenGenerator.hashCode(other.getId(), "111222"));
        old.setCreatedAt(clock.instant().minusSeconds(31 * 60));
        when(resetTokens.findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(other.getId())).thenReturn(Optional.of(old));
        assertThatThrownBy(() -> service.resetPasswordWithCode("a@b.com", "111222", "AnotherPass2")).isInstanceOf(ApiException.class);
    }
}
