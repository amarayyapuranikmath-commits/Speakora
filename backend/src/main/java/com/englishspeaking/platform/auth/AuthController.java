package com.englishspeaking.platform.auth;

import com.englishspeaking.platform.auth.AuthDtos.*;
import com.englishspeaking.platform.security.AppProperties;
import com.englishspeaking.platform.security.AuthPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    static final String COOKIE = "refresh_token";
    private static final String COOKIE_PATH = "/api/auth";

    private final AuthService auth;
    private final AppProperties props;

    public AuthController(AuthService auth, AppProperties props) {
        this.auth = auth;
        this.props = props;
    }

    static final String CLIENT_TYPE = "X-Client-Type";
    static final String REFRESH_HEADER = "X-Refresh-Token";

    static boolean isMobile(HttpServletRequest request) { return "mobile".equalsIgnoreCase(request.getHeader(CLIENT_TYPE)); }

    @PostMapping("/register")
    public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest req, HttpServletRequest http) {
        return respond(HttpStatus.CREATED, auth.register(req, http.getHeader("User-Agent")), http);
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@Valid @RequestBody LoginRequest req, HttpServletRequest http) {
        return respond(HttpStatus.OK, auth.login(req, http.getHeader("User-Agent")), http);
    }

    @PostMapping("/refresh")
    public ResponseEntity<?> refresh(HttpServletRequest http) {
        try {
            return respond(HttpStatus.OK, auth.refresh(readToken(http), http.getHeader("User-Agent")), http);
        } catch (RuntimeException e) {
            // Drop a bad cookie so the browser stops replaying it.
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .header(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString())
                    .body(null);
        }
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest http) {
        auth.logout(readToken(http));
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString()).build();
    }

    @PostMapping("/verify-email")
    public ResponseEntity<Void> verifyEmail(@Valid @RequestBody VerifyEmailRequest req) {
        auth.verifyEmail(req.token());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/verify-email-code")
    public ResponseEntity<Void> verifyEmailCode(@AuthenticationPrincipal AuthPrincipal me, @Valid @RequestBody VerifyEmailCodeRequest req) {
        auth.verifyEmailCode(me.userId(), req.code());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/reset-password-code")
    public ResponseEntity<Void> resetWithCode(@Valid @RequestBody ResetPasswordCodeRequest req) {
        auth.resetPasswordWithCode(req.email(), req.code(), req.newPassword());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/resend-verification")
    public ResponseEntity<Void> resend(@AuthenticationPrincipal AuthPrincipal me) {
        auth.resendVerification(me.userId());
        return ResponseEntity.accepted().build();
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<Void> forgot(@Valid @RequestBody ForgotPasswordRequest req) {
        auth.forgotPassword(req.email());
        return ResponseEntity.accepted().build();
    }

    @PostMapping("/reset-password")
    public ResponseEntity<Void> reset(@Valid @RequestBody ResetPasswordRequest req) {
        auth.resetPassword(req.token(), req.newPassword());
        return ResponseEntity.noContent().build();
    }

    /** Browsers get the refresh token as an httpOnly cookie; native apps get it in the body (they have no cookie jar to rely on). */
    private ResponseEntity<?> respond(HttpStatus status, AuthResult result, HttpServletRequest http) {
        if (isMobile(http)) return ResponseEntity.status(status).body(result.toMobileResponse());
        return withCookie(status, result);
    }

    /** Cookie for browsers; the X-Refresh-Token header only counts for mobile clients. */
    private static String readToken(HttpServletRequest http) {
        if (isMobile(http)) {
            String header = http.getHeader(REFRESH_HEADER);
            if (header != null && !header.isBlank()) return header;
        }
        return readCookie(http);
    }

    private ResponseEntity<SessionResponse> withCookie(HttpStatus status, AuthResult result) {
        return ResponseEntity.status(status)
                .header(HttpHeaders.SET_COOKIE, cookie(result.refreshToken(), Duration.ofDays(props.refreshTtlDays())).toString())
                .body(result.toResponse());
    }

    ResponseCookie cookie(String value, Duration maxAge) {
        return ResponseCookie.from(COOKIE, value).httpOnly(true).secure(props.cookieSecure()).sameSite("Strict")
                .path(COOKIE_PATH).maxAge(maxAge).build();
    }

    private static String readCookie(HttpServletRequest request) {
        if (request.getCookies() == null) return null;
        for (var c : request.getCookies()) if (COOKIE.equals(c.getName())) return c.getValue();
        return null;
    }
}
