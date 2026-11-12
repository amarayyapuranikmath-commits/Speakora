package com.englishspeaking.platform.user;

import com.englishspeaking.platform.auth.AuthController;
import com.englishspeaking.platform.auth.AuthDtos.*;
import com.englishspeaking.platform.auth.AuthService;
import com.englishspeaking.platform.security.AppProperties;
import com.englishspeaking.platform.security.AuthPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;

@RestController
@RequestMapping("/api")
public class AccountController {
    private final AccountService accounts;
    private final AuthService auth;
    private final AppProperties props;

    public AccountController(AccountService accounts, AuthService auth, AppProperties props) {
        this.accounts = accounts;
        this.auth = auth;
        this.props = props;
    }

    @GetMapping("/me")
    public UserSummary me(@AuthenticationPrincipal AuthPrincipal me) { return accounts.me(me.userId()); }

    @PostMapping("/account/password")
    public ResponseEntity<?> changePassword(@AuthenticationPrincipal AuthPrincipal me,
                                                          @Valid @RequestBody ChangePasswordRequest req, HttpServletRequest http) {
        AuthResult result = auth.changePassword(me.userId(), req, http.getHeader("User-Agent"));
        if ("mobile".equalsIgnoreCase(http.getHeader("X-Client-Type"))) return ResponseEntity.ok(result.toMobileResponse());
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, refreshCookie(result.refreshToken(), Duration.ofDays(props.refreshTtlDays())).toString())
                .body(result.toResponse());
    }

    @DeleteMapping("/account")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal AuthPrincipal me, @Valid @RequestBody DeleteAccountRequest req) {
        accounts.deleteAccount(me.userId(), req.password());
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, refreshCookie("", Duration.ZERO).toString()).build();
    }

    private ResponseCookie refreshCookie(String value, Duration maxAge) {
        return ResponseCookie.from("refresh_token", value).httpOnly(true).secure(props.cookieSecure()).sameSite("Strict")
                .path("/api/auth").maxAge(maxAge).build();
    }
}
