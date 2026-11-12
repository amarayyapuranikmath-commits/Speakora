package com.englishspeaking.platform.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.englishspeaking.platform.common.ApiError;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.Set;

/** Strict limits on credential endpoints (per client IP) and a general per-IP limit on the API. */
@Component
public class RateLimitFilter extends OncePerRequestFilter {
    private static final Set<String> SENSITIVE = Set.of(
            "/api/auth/login", "/api/auth/register", "/api/auth/forgot-password",
            "/api/auth/reset-password", "/api/auth/resend-verification", "/api/auth/verify-email",
            "/api/auth/verify-email-code", "/api/auth/reset-password-code");

    private final RateLimiter limiter;
    private final ObjectMapper mapper;
    private final ClientIpResolver clientIps;

    public RateLimitFilter(RateLimiter limiter, ObjectMapper mapper, ClientIpResolver clientIps) {
        this.limiter = limiter;
        this.mapper = mapper;
        this.clientIps = clientIps;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        // The verified caller, never a header a client could choose (see ClientIpResolver).
        String ip = clientIps.clientAddress(request);
        String path = request.getRequestURI();
        boolean allowed = limiter.tryAcquire("api:" + ip, 300, Duration.ofMinutes(1));
        if (allowed && SENSITIVE.contains(path)) {
            allowed = limiter.tryAcquire("auth:" + ip + ":" + path, 10, Duration.ofMinutes(1));
        }
        if (!allowed) {
            response.setStatus(429);
            response.setHeader("Retry-After", "60");
            response.setContentType("application/json");
            mapper.writeValue(response.getWriter(), ApiError.of("RATE_LIMITED", "Too many requests. Please wait a moment and try again."));
            return;
        }
        chain.doFilter(request, response);
    }
}
