package com.englishspeaking.platform.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Past;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.UUID;

public final class AuthDtos {
    private AuthDtos() {}

    public static final String PASSWORD_PATTERN = "^(?=.*[A-Za-z])(?=.*\\d).{8,72}$";
    public static final String PASSWORD_MESSAGE = "Use 8 to 72 characters with at least one letter and one number.";

    public record RegisterRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Pattern(regexp = PASSWORD_PATTERN, message = PASSWORD_MESSAGE) String password,
            @NotBlank @Size(min = 2, max = 40) String displayName,
            @NotNull @Past LocalDate dateOfBirth) {}

    public record LoginRequest(@NotBlank @Email String email, @NotBlank @Size(max = 72) String password) {}

    public record VerifyEmailRequest(@NotBlank @Size(max = 200) String token) {}

    public record ForgotPasswordRequest(@NotBlank @Email String email) {}

    public record VerifyEmailCodeRequest(@NotBlank @Pattern(regexp = "^[0-9]{6}$", message = "Enter the 6-digit code.") String code) {}

    public record ResetPasswordCodeRequest(
            @NotBlank @Email String email,
            @NotBlank @Pattern(regexp = "^[0-9]{6}$", message = "Enter the 6-digit code.") String code,
            @NotBlank @Pattern(regexp = PASSWORD_PATTERN, message = PASSWORD_MESSAGE) String newPassword) {}

    public record ResetPasswordRequest(
            @NotBlank @Size(max = 200) String token,
            @NotBlank @Pattern(regexp = PASSWORD_PATTERN, message = PASSWORD_MESSAGE) String newPassword) {}

    public record ChangePasswordRequest(
            @NotBlank @Size(max = 72) String currentPassword,
            @NotBlank @Pattern(regexp = PASSWORD_PATTERN, message = PASSWORD_MESSAGE) String newPassword) {}

    public record DeleteAccountRequest(@NotBlank @Size(max = 72) String password) {}

    public record UserSummary(UUID id, String email, boolean emailVerified, String displayName, boolean onboardingCompleted, String role) {}

    /** Body returned to the client; the refresh token travels only in an httpOnly cookie. */
    public record SessionResponse(String accessToken, long expiresInSeconds, UserSummary user, String verificationEmailProblem) {}

    /** What native mobile apps receive: the same plus the refresh token, which they keep in the Android Keystore (no cookie jar). */
    public record MobileSessionResponse(String accessToken, long expiresInSeconds, UserSummary user, String refreshToken, String verificationEmailProblem) {}

    /** Internal result that also carries the raw refresh token for the controller to set as a cookie. */
    public record AuthResult(String accessToken, long expiresInSeconds, String refreshToken, UserSummary user, String verificationEmailProblem) {
        public AuthResult(String accessToken, long expiresInSeconds, String refreshToken, UserSummary user) { this(accessToken, expiresInSeconds, refreshToken, user, null); }
        /** Sign-up only: set when the account was made but the first code email could not be sent (the person is told, and can ask again). */
        public AuthResult withVerificationEmailProblem(String problem) { return new AuthResult(accessToken, expiresInSeconds, refreshToken, user, problem); }
        public SessionResponse toResponse() { return new SessionResponse(accessToken, expiresInSeconds, user, verificationEmailProblem); }
        public MobileSessionResponse toMobileResponse() { return new MobileSessionResponse(accessToken, expiresInSeconds, user, refreshToken, verificationEmailProblem); }
    }
}
