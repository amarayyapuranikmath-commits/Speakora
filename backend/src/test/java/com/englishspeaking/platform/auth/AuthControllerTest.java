package com.englishspeaking.platform.auth;

import com.englishspeaking.platform.TestSupport;
import com.englishspeaking.platform.auth.AuthDtos.*;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.common.GlobalExceptionHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class AuthControllerTest {
    AuthService auth = mock(AuthService.class);
    MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new AuthController(auth, TestSupport.props()))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    private static final String VALID = """
            {"email":"a@b.com","password":"Passw0rdOK","displayName":"Ana","dateOfBirth":"1990-05-01"}""";

    @Test
    void registerReturnsAccessTokenInBodyAndRefreshTokenOnlyInHttpOnlyCookie() throws Exception {
        var user = new UserSummary(UUID.randomUUID(), "a@b.com", false, "Ana", false, "USER");
        when(auth.register(any(), any())).thenReturn(new AuthResult("access.jwt", 900, "raw-refresh", user));

        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(VALID))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accessToken").value("access.jwt"))
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.allOf(
                        org.hamcrest.Matchers.containsString("refresh_token=raw-refresh"),
                        org.hamcrest.Matchers.containsString("HttpOnly"),
                        org.hamcrest.Matchers.containsString("SameSite=Strict"),
                        org.hamcrest.Matchers.containsString("Path=/api/auth"))));
    }

    @Test
    void mobileClientsGetTheRefreshTokenInTheBodyAndNoCookie() throws Exception {
        var user = new UserSummary(UUID.randomUUID(), "a@b.com", false, "Ana", false, "USER");
        when(auth.login(any(), any())).thenReturn(new AuthResult("access.jwt", 900, "raw-refresh", user));

        mvc.perform(post("/api/auth/login").header("X-Client-Type", "mobile").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"a@b.com\",\"password\":\"x\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.refreshToken").value("raw-refresh"))
                .andExpect(jsonPath("$.accessToken").value("access.jwt"))
                .andExpect(header().doesNotExist("Set-Cookie"));
    }

    @Test
    void browsersNeverGetTheRefreshTokenInTheBodyEvenIfTheyAskLikeAMobileClientWithoutTheHeader() throws Exception {
        var user = new UserSummary(UUID.randomUUID(), "a@b.com", false, "Ana", false, "USER");
        when(auth.login(any(), any())).thenReturn(new AuthResult("access.jwt", 900, "raw-refresh", user));
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"a@b.com\",\"password\":\"x\"}"))
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andExpect(header().exists("Set-Cookie"));
    }

    @Test
    void theRefreshHeaderIsHonouredOnlyForMobileClients() throws Exception {
        var user = new UserSummary(UUID.randomUUID(), "a@b.com", false, "Ana", false, "USER");
        when(auth.refresh(org.mockito.ArgumentMatchers.eq("stored-token"), any())).thenReturn(new AuthResult("new.jwt", 900, "rotated", user));
        when(auth.refresh(org.mockito.ArgumentMatchers.isNull(), any())).thenThrow(ApiException.unauthorized("UNAUTHENTICATED", "no"));

        mvc.perform(post("/api/auth/refresh").header("X-Client-Type", "mobile").header("X-Refresh-Token", "stored-token"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.refreshToken").value("rotated"));
        // a browser-style request cannot use the header (it would be cross-site-forgeable if it could)
        mvc.perform(post("/api/auth/refresh").header("X-Refresh-Token", "stored-token")).andExpect(status().isUnauthorized());
    }

    @Test
    void registerValidatesInputAndReportsFieldErrors() throws Exception {
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"not-an-email","password":"short","displayName":"A","dateOfBirth":"1990-05-01"}"""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.details.email").exists())
                .andExpect(jsonPath("$.details.password").exists())
                .andExpect(jsonPath("$.details.displayName").exists());
    }

    @Test
    void malformedJsonIsABadRequestNotAServerError() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{nope"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"));
    }

    @Test
    void businessErrorsMapToTheirStatusWithoutLeakingInternals() throws Exception {
        when(auth.login(any(), any())).thenThrow(ApiException.unauthorized("INVALID_CREDENTIALS", "Incorrect email or password."));
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"a@b.com\",\"password\":\"x\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    }

    @Test
    void unexpectedFailureReturnsGenericMessage() throws Exception {
        when(auth.login(any(), any())).thenThrow(new IllegalStateException("jdbc:postgresql://secret-host password=hunter2"));
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"a@b.com\",\"password\":\"x\"}"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("hunter2"))));
    }

    @Test
    void failedRefreshClearsTheCookie() throws Exception {
        when(auth.refresh(any(), any())).thenThrow(ApiException.unauthorized("UNAUTHENTICATED", "Please sign in again."));
        mvc.perform(post("/api/auth/refresh"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
    }

    @Test
    void logoutAlwaysClearsTheCookie() throws Exception {
        mvc.perform(post("/api/auth/logout"))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
    }
}
