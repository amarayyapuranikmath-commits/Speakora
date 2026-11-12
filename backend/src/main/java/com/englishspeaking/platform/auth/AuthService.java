package com.englishspeaking.platform.auth;

import com.englishspeaking.platform.auth.AuthDtos.*;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.notification.MailDeliveryException;
import com.englishspeaking.platform.notification.MailService;
import com.englishspeaking.platform.preferences.UserPreferences;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.security.AppProperties;
import com.englishspeaking.platform.security.JwtService;
import com.englishspeaking.platform.security.RateLimiter;
import com.englishspeaking.platform.statistics.UserStatistics;
import com.englishspeaking.platform.statistics.UserStatisticsRepository;
import com.englishspeaking.platform.user.AdminBootstrap;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import com.englishspeaking.platform.user.UserStatus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Period;
import java.time.ZoneOffset;
import java.util.UUID;

@Service
public class AuthService {
    static final int MIN_AGE = 18;
    /** A just-rotated token presented again within this window is treated as a benign race, not theft. */
    static final Duration REUSE_GRACE = Duration.ofSeconds(10);
    private static final Duration VERIFY_TTL = Duration.ofHours(24);
    private static final Duration RESET_TTL = Duration.ofHours(1);
    private static final Duration CODE_TTL = Duration.ofMinutes(30);
    /**
     * There is no waiting time between two requests for a code: pressing Resend sends a fresh code at once. What stops flooding is a limit per account
     * (or, for a forgotten password, per address): this many codes in this window. The per-address limit counts requests whether or not the address has
     * an account, so it reveals nothing about who has one. A separate daily cap keeps the whole service inside what the mail provider allows
     * (Gmail: about 500 a day for a personal account). Each limit answers with a clear message and a Retry-After.
     */
    public static final int MAX_CODES_PER_WINDOW = 6;
    static final Duration CODE_WINDOW = Duration.ofMinutes(15);
    static final Duration DAILY_WINDOW = Duration.ofDays(1);
    private static final int MAX_CODE_ATTEMPTS = 5;

    private final UserRepository users;
    private final UserProfileRepository profiles;
    private final UserPreferencesRepository preferences;
    private final UserStatisticsRepository statistics;
    private final RefreshTokenRepository refreshTokens;
    private final EmailVerificationTokenRepository verificationTokens;
    private final PasswordResetTokenRepository resetTokens;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final MailService mail;
    private final AppProperties props;
    private final Clock clock;
    private final AdminBootstrap adminBootstrap;
    private final RateLimiter limiter;
    private final int dailyEmailLimit;
    private final String dummyHash;

    public AuthService(UserRepository users, UserProfileRepository profiles, UserPreferencesRepository preferences,
                       UserStatisticsRepository statistics, RefreshTokenRepository refreshTokens,
                       EmailVerificationTokenRepository verificationTokens, PasswordResetTokenRepository resetTokens,
                       PasswordEncoder encoder, JwtService jwt, MailService mail, AppProperties props, Clock clock,
                       AdminBootstrap adminBootstrap, RateLimiter limiter, @Value("${app.mail-daily-limit:400}") int dailyEmailLimit) {
        this.adminBootstrap = adminBootstrap;
        this.limiter = limiter;
        this.dailyEmailLimit = dailyEmailLimit;
        this.users = users;
        this.profiles = profiles;
        this.preferences = preferences;
        this.statistics = statistics;
        this.refreshTokens = refreshTokens;
        this.verificationTokens = verificationTokens;
        this.resetTokens = resetTokens;
        this.encoder = encoder;
        this.jwt = jwt;
        this.mail = mail;
        this.props = props;
        this.clock = clock;
        this.dummyHash = encoder.encode("timing-equaliser-" + UUID.randomUUID());
    }

    @Transactional
    public AuthResult register(RegisterRequest req, String userAgent) {
        LocalDate today = LocalDate.now(clock.withZone(ZoneOffset.UTC));
        if (Period.between(req.dateOfBirth(), today).getYears() < MIN_AGE) {
            throw ApiException.badRequest("UNDERAGE", "You must be at least 18 years old to use this service.");
        }
        if (Period.between(req.dateOfBirth(), today).getYears() > 120) {
            throw ApiException.badRequest("INVALID_DATE_OF_BIRTH", "Please enter a valid date of birth.");
        }
        String email = normalise(req.email());
        if (users.existsByEmail(email)) {
            throw ApiException.conflict("EMAIL_TAKEN", "An account with this email already exists.");
        }
        User user = users.save(new User(email, encoder.encode(req.password()), req.dateOfBirth()));
        profiles.save(new UserProfile(user.getId(), req.displayName().trim()));
        preferences.save(new UserPreferences(user.getId()));
        statistics.save(new UserStatistics(user.getId()));
        // The account is made even if the first email cannot be sent: the person is told so (and why) and can ask for the code again.
        String emailProblem = null;
        try {
            issueVerificationToken(user);
        } catch (ApiException e) {
            emailProblem = e.getMessage();
        }
        AuthResult result = startSession(user, userAgent);
        return emailProblem == null ? result : result.withVerificationEmailProblem(emailProblem);
    }

    @Transactional
    public AuthResult login(LoginRequest req, String userAgent) {
        User user = users.findByEmail(normalise(req.email())).orElse(null);
        // Always run one BCrypt comparison so response time does not reveal whether the email exists.
        boolean passwordOk = encoder.matches(req.password(), user == null ? dummyHash : user.getPasswordHash());
        if (user == null || user.getStatus() == UserStatus.DELETED || !passwordOk) {
            throw ApiException.unauthorized("INVALID_CREDENTIALS", "Incorrect email or password.");
        }
        requireActive(user);
        return startSession(user, userAgent);
    }

    /** Rotates the refresh token. Reuse of an already-rotated token revokes the whole family. */
    @Transactional(noRollbackFor = ApiException.class)
    public AuthResult refresh(String rawToken, String userAgent) {
        if (rawToken == null || rawToken.isBlank()) throw ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again.");
        Instant now = clock.instant();
        RefreshToken stored = refreshTokens.findByTokenHash(TokenGenerator.hash(rawToken))
                .orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again."));
        if (stored.getRevokedAt() != null) {
            if (stored.getRevokedAt().plus(REUSE_GRACE).isBefore(now)) {
                refreshTokens.revokeFamily(stored.getFamilyId(), now);
            }
            throw ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again.");
        }
        if (!stored.getExpiresAt().isAfter(now)) throw ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again.");
        User user = users.findById(stored.getUserId()).orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again."));
        if (user.getStatus() != UserStatus.ACTIVE) {
            refreshTokens.revokeFamily(stored.getFamilyId(), now);
            throw ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again.");
        }
        stored.revoke(now);
        return issue(user, stored.getFamilyId(), userAgent);
    }

    @Transactional
    public void logout(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) return;
        refreshTokens.findByTokenHash(TokenGenerator.hash(rawToken))
                .ifPresent(t -> refreshTokens.revokeFamily(t.getFamilyId(), clock.instant()));
    }

    @Transactional
    public void verifyEmail(String rawToken) {
        Instant now = clock.instant();
        EmailVerificationToken token = verificationTokens.findByTokenHash(TokenGenerator.hash(rawToken))
                .filter(t -> t.isUsable(now))
                .orElseThrow(() -> ApiException.badRequest("INVALID_TOKEN", "This verification link is invalid or has expired."));
        token.markUsed(now);
        users.findById(token.getUserId()).ifPresent(u -> {
            u.setEmailVerified(true);
            adminBootstrap.promoteIfListed(u);
        });
    }

    /** Sends a fresh code right away. The newest email is the only one that works. A failure to send is reported, never ignored. */
    @Transactional
    public void resendVerification(UUID userId) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("NOT_FOUND", "Account not found."));
        if (user.isEmailVerified()) return;
        requireWithinLimits("otp:verify:" + userId);
        issueVerificationToken(user);
    }

    /**
     * Confirms the signed-in person's email address with the six-digit code from the email. A wrong code throws, but its failed attempt must
     * still be saved (otherwise the limit on guesses would never be reached), so this transaction does not roll back for ApiException.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public void verifyEmailCode(UUID userId, String code) {
        Instant now = clock.instant();
        EmailVerificationToken token = verificationTokens.findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(userId)
                .filter(t -> t.isUsable(now) && codeIsFresh(t, now))
                .orElseThrow(() -> ApiException.badRequest("INVALID_CODE", "That code has expired. Ask for a new one."));
        checkCode(token, userId, code, now);
        token.markUsed(now);
        users.findById(userId).ifPresent(u -> {
            u.setEmailVerified(true);
            adminBootstrap.promoteIfListed(u);
        });
    }

    /** A code works for 30 minutes (the email says so), even though the link in the same email lives longer. */
    private static boolean codeIsFresh(OneTimeToken token, Instant now) {
        return Duration.between(token.getCreatedAt(), now).compareTo(CODE_TTL) <= 0;
    }

    /** Compares a typed code with the stored hash. A wrong guess counts against the token, which dies after a few. Throws when wrong. */
    private void checkCode(OneTimeToken token, UUID userId, String code, Instant now) {
        boolean match = token.getCodeHash() != null && java.security.MessageDigest.isEqual(
                token.getCodeHash().getBytes(java.nio.charset.StandardCharsets.UTF_8), TokenGenerator.hashCode(userId, code).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        if (match) return;
        token.recordFailedAttempt();
        if (token.getFailedAttempts() >= MAX_CODE_ATTEMPTS) {
            token.markUsed(now); // spent: a new code has to be requested
            throw ApiException.badRequest("INVALID_CODE", "Too many wrong codes. Ask for a new one.");
        }
        throw ApiException.badRequest("INVALID_CODE", "That code is not right. Check it and try again.");
    }

    /**
     * Sends a reset code to the account's address, at once, every time it is asked for. The answer is the same whether or not an account exists, so it
     * reveals nothing about who has one: the limit is counted per address either way, and only a failure of the mail service itself (which has
     * nothing to do with the address) is reported as a failure.
     */
    @Transactional
    public void forgotPassword(String email) {
        String address = normalise(email);
        requireWithinLimits("otp:reset:" + sha256(address));
        users.findByEmail(address).filter(u -> u.getStatus() == UserStatus.ACTIVE).ifPresent(this::issueResetToken);
    }

    @Transactional
    public void resetPassword(String rawToken, String newPassword) {
        Instant now = clock.instant();
        PasswordResetToken token = resetTokens.findByTokenHash(TokenGenerator.hash(rawToken))
                .filter(t -> t.isUsable(now))
                .orElseThrow(() -> ApiException.badRequest("INVALID_TOKEN", "This reset link is invalid or has expired."));
        User user = users.findById(token.getUserId()).orElseThrow(() -> ApiException.badRequest("INVALID_TOKEN", "This reset link is invalid or has expired."));
        token.markUsed(now);
        user.setPasswordHash(encoder.encode(newPassword));
        refreshTokens.revokeAllForUser(user.getId(), now);
    }

    /** Sets a new password with the six-digit code from the reset email. Every failure looks the same, so it reveals nothing about accounts. */
    @Transactional(noRollbackFor = ApiException.class)
    public void resetPasswordWithCode(String email, String code, String newPassword) {
        Instant now = clock.instant();
        ApiException invalid = ApiException.badRequest("INVALID_CODE", "That code is not right or has expired. Check it, or ask for a new one.");
        User user = users.findByEmail(normalise(email)).filter(u -> u.getStatus() == UserStatus.ACTIVE).orElseThrow(() -> invalid);
        PasswordResetToken token = resetTokens.findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(user.getId())
                .filter(t -> t.isUsable(now) && codeIsFresh(t, now)).orElseThrow(() -> invalid);
        checkCode(token, user.getId(), code, now);
        token.markUsed(now);
        user.setPasswordHash(encoder.encode(newPassword));
        refreshTokens.revokeAllForUser(user.getId(), now);
    }

    @Transactional
    public AuthResult changePassword(UUID userId, ChangePasswordRequest req, String userAgent) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again."));
        if (!encoder.matches(req.currentPassword(), user.getPasswordHash())) {
            throw ApiException.badRequest("WRONG_PASSWORD", "Your current password is incorrect.");
        }
        user.setPasswordHash(encoder.encode(req.newPassword()));
        refreshTokens.revokeAllForUser(userId, clock.instant());
        return startSession(user, userAgent);
    }

    /**
     * Creates a fresh code and link, emails them, and only then retires the earlier ones, so a failure to send never takes away a code the person
     * already has. Throws an ApiException with a clear message when the email cannot be sent (the new code is then discarded too).
     */
    private void issueVerificationToken(User user) {
        String raw = TokenGenerator.newToken();
        String code = TokenGenerator.newCode();
        Instant now = clock.instant();
        Instant at = verificationTokens.findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(user.getId())
                .map(last -> last.getCreatedAt().isBefore(now) ? now : last.getCreatedAt().plusNanos(1000)).orElse(now); // always newer than the last one
        EmailVerificationToken token = new EmailVerificationToken(user.getId(), TokenGenerator.hash(raw), now.plus(VERIFY_TTL), TokenGenerator.hashCode(user.getId(), code));
        token.setCreatedAt(at);
        verificationTokens.save(token);
        sendCodeEmail(() -> mail.sendVerificationEmail(user.getEmail(), raw, code));
        verificationTokens.retireOthers(user.getId(), token.getId(), now);
    }

    private void issueResetToken(User user) {
        String raw = TokenGenerator.newToken();
        String code = TokenGenerator.newCode();
        Instant now = clock.instant();
        Instant at = resetTokens.findFirstByUserIdAndCodeHashIsNotNullOrderByCreatedAtDesc(user.getId())
                .map(last -> last.getCreatedAt().isBefore(now) ? now : last.getCreatedAt().plusNanos(1000)).orElse(now);
        PasswordResetToken token = new PasswordResetToken(user.getId(), TokenGenerator.hash(raw), now.plus(RESET_TTL), TokenGenerator.hashCode(user.getId(), code));
        token.setCreatedAt(at);
        resetTokens.save(token);
        sendCodeEmail(() -> mail.sendPasswordResetEmail(user.getEmail(), raw, code));
        resetTokens.retireOthers(user.getId(), token.getId(), now);
    }

    /** The daily cap protects the sending account; it is only used up by emails that are really going to be sent. 0 switches it off. */
    private void requireDailyCapacity() {
        if (dailyEmailLimit > 0 && !limiter.tryAcquire("otp:day", dailyEmailLimit, DAILY_WINDOW)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "EMAIL_DAILY_LIMIT",
                    "We have reached today's limit for sending emails, which our email provider sets. Please try again tomorrow.", 3600);
        }
    }

    private void requireWithinLimits(String key) {
        if (!limiter.tryAcquire(key, MAX_CODES_PER_WINDOW, CODE_WINDOW)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_CODES",
                    "You have asked for several codes in a short time. To keep email delivery reliable, please wait about " + CODE_WINDOW.toMinutes()
                            + " minutes before asking again. The newest code you received still works.", (int) CODE_WINDOW.toSeconds());
        }
    }

    private void sendCodeEmail(Runnable send) {
        requireDailyCapacity();
        try {
            send.run();
        } catch (MailDeliveryException e) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "EMAIL_SEND_FAILED", describeFailure(e.kind()));
        }
    }

    /** What the person is told when the email could not be sent. It says what happened and what to do, and never shows a credential or a server detail. */
    static String describeFailure(MailDeliveryException.Kind kind) {
        return switch (kind) {
            case NOT_CONFIGURED -> "We could not send the email because email sending is not set up on this server yet. Please contact support.";
            case LOGIN_REFUSED, SENDER_REFUSED -> "We could not send the email because our email service refused to accept it. This is a problem on our side, not yours. Please try again later.";
            case RECIPIENT_REFUSED -> "The email service refused this address. Please check that it is typed correctly.";
            case TIMEOUT -> "The email service did not answer in time. Please try again in a moment.";
            case CONNECTION -> "We could not reach the email service. Please try again in a moment.";
            case OTHER -> "We could not send the email right now. Please try again in a moment.";
        };
    }

    private static String sha256(String text) {
        try {
            return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private AuthResult startSession(User user, String userAgent) { return issue(user, UUID.randomUUID(), userAgent); }

    private AuthResult issue(User user, UUID familyId, String userAgent) {
        String raw = TokenGenerator.newToken();
        refreshTokens.save(new RefreshToken(user.getId(), TokenGenerator.hash(raw), familyId,
                clock.instant().plus(Duration.ofDays(props.refreshTtlDays())), userAgent));
        String access = jwt.createAccessToken(user.getId(), user.getRole());
        return new AuthResult(access, jwt.accessTtl().toSeconds(), raw, summary(user));
    }

    public static void requireActive(User user) {
        if (user.getStatus() == UserStatus.SUSPENDED) {
            throw ApiException.forbidden("ACCOUNT_SUSPENDED", "This account has been suspended.");
        }
    }

    public UserSummary summary(User user) {
        String name = profiles.findById(user.getId()).map(UserProfile::getDisplayName).orElse("");
        return new UserSummary(user.getId(), user.getEmail(), user.isEmailVerified(), name, user.isOnboardingCompleted(), user.getRole());
    }

    private static String normalise(String email) { return email.trim().toLowerCase(); }
}
