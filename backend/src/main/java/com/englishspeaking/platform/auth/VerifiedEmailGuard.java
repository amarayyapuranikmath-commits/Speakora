package com.englishspeaking.platform.auth;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.security.AuthPrincipal;
import com.englishspeaking.platform.user.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Keeps an account whose email address is not verified out of everything that reaches other people: random matching and calls (the
 * real-time ticket), friends, friend requests and private messages. Signing in, the verification and password endpoints, learning,
 * the AI tutor and the profile stay open so a new user can still enter the code and look around.
 *
 * <p>Switched by {@code app.require-verified-email} (REQUIRE_VERIFIED_EMAIL). Production turns it on; local development and the
 * automated suites leave it off because they sign up and use accounts at once, and a dedicated test turns it on.
 */
@Configuration
public class VerifiedEmailGuard implements WebMvcConfigurer {
    private final UserRepository users;
    private final boolean required;

    public VerifiedEmailGuard(UserRepository users, @Value("${app.require-verified-email:false}") boolean required) {
        this.users = users;
        this.required = required;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                if (!required) return true;
                Authentication auth = SecurityContextHolder.getContext().getAuthentication();
                if (auth == null || !(auth.getPrincipal() instanceof AuthPrincipal principal)) return true; // not signed in: security answers 401
                boolean verified = users.findById(principal.userId()).map(u -> u.isEmailVerified()).orElse(true);
                if (!verified) {
                    throw ApiException.forbidden("EMAIL_NOT_VERIFIED", "Verify your email address first. Enter the six-digit code we sent you, or ask for a new one.");
                }
                return true;
            }
        }).addPathPatterns("/api/ws/ticket", "/api/friends/**", "/api/partners/**");
    }
}
