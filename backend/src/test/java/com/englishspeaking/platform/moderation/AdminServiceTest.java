package com.englishspeaking.platform.moderation;

import com.englishspeaking.platform.TestSupport;
import com.englishspeaking.platform.auth.RefreshTokenRepository;
import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.calling.CallSession;
import com.englishspeaking.platform.calling.EndReason;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.moderation.AdminService.ResolveAction;
import com.englishspeaking.platform.moderation.AdminService.ResolveRequest;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.security.RevokedSessions;
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
import org.springframework.context.ApplicationEventPublisher;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AdminServiceTest {
    @Mock UserRepository users;
    @Mock UserProfileRepository profiles;
    @Mock UserReportRepository reports;
    @Mock ModerationActionRepository actions;
    @Mock RefreshTokenRepository refreshTokens;
    @Mock CallService calls;
    @Mock RevokedSessions revoked;
    @Mock ApplicationEventPublisher events;

    final TestSupport.MutableClock clock = new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z"));
    AdminService service;
    final UUID admin = UUID.randomUUID();
    User target;

    @BeforeEach
    void setUp() {
        service = new AdminService(users, profiles, reports, actions, refreshTokens, calls, revoked, events, clock);
        target = new User("t@example.com", "h", LocalDate.of(1990, 1, 1));
        when(users.findById(target.getId())).thenReturn(Optional.of(target));
    }

    @Test
    void suspendingCutsOffEverySessionAndRecordsTheDecision() {
        CallSession active = new CallSession(UUID.randomUUID(), null, clock.instant());
        when(calls.activeCallOf(target.getId())).thenReturn(Optional.of(active));

        service.suspend(admin, target.getId(), "  harassment  ");

        assertThat(target.getStatus()).isEqualTo(UserStatus.SUSPENDED);
        assertThat(target.getSuspendedReason()).isEqualTo("harassment");
        verify(refreshTokens).revokeAllForUser(eq(target.getId()), any());   // no new access tokens
        verify(revoked).block(target.getId());                                 // existing tokens stop working
        verify(calls).end(active.getId(), target.getId(), EndReason.ENDED);    // partner not left hanging
        verify(events).publishEvent(new UserSuspendedEvent(target.getId()));   // queue + socket cleanup
        ArgumentCaptor<ModerationAction> saved = ArgumentCaptor.forClass(ModerationAction.class);
        verify(actions).save(saved.capture());
        assertThat(saved.getValue().getAction()).isEqualTo(ModerationAction.Type.SUSPEND);
        assertThat(saved.getValue().getAdminId()).isEqualTo(admin);
    }

    @Test
    void adminsAndSelfCannotBeSuspendedAndRepeatsAreRejected() {
        assertThatThrownBy(() -> service.suspend(admin, admin, "x")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("SELF_SUSPEND"));
        target.setRole("ADMIN");
        assertThatThrownBy(() -> service.suspend(admin, target.getId(), "x")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("ADMIN_PROTECTED"));
        target.setRole("USER");
        target.setStatus(UserStatus.SUSPENDED);
        assertThatThrownBy(() -> service.suspend(admin, target.getId(), "x")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("ALREADY_SUSPENDED"));
        target.setStatus(UserStatus.DELETED);
        assertThatThrownBy(() -> service.suspend(admin, target.getId(), "x")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("USER_DELETED"));
        verify(revoked, never()).block(any());
    }

    @Test
    void unsuspendRestoresAccessAndClearsTheRevocation() {
        target.setStatus(UserStatus.SUSPENDED);
        target.setSuspendedReason("x");
        service.unsuspend(admin, target.getId());
        assertThat(target.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(target.getSuspendedReason()).isNull();
        verify(revoked).unblock(target.getId());
        assertThatThrownBy(() -> service.unsuspend(admin, target.getId())).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("NOT_SUSPENDED"));
    }

    private UserReport openReport() {
        UserReport r = new UserReport(UUID.randomUUID(), target.getId(), UUID.randomUUID(), ReportReason.HARASSMENT, "rude");
        when(reports.findById(r.getId())).thenReturn(Optional.of(r));
        return r;
    }

    @Test
    void actioningAReportSuspendsTheReportedUserAndClosesTheReport() {
        UserReport r = openReport();
        service.resolveReport(admin, r.getId(), new ResolveRequest(ResolveAction.SUSPEND, "confirmed"));
        assertThat(r.getStatus()).isEqualTo(UserReport.ACTIONED);
        assertThat(target.getStatus()).isEqualTo(UserStatus.SUSPENDED);
        assertThat(r.getResolutionNote()).isEqualTo("confirmed");
    }

    @Test
    void dismissingLeavesTheUserAloneAndAReportCanOnlyBeResolvedOnce() {
        UserReport r = openReport();
        service.resolveReport(admin, r.getId(), new ResolveRequest(ResolveAction.DISMISS, null));
        assertThat(r.getStatus()).isEqualTo(UserReport.DISMISSED);
        assertThat(target.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThatThrownBy(() -> service.resolveReport(admin, r.getId(), new ResolveRequest(ResolveAction.SUSPEND, null)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("REPORT_ALREADY_RESOLVED"));
        assertThat(target.getStatus()).isEqualTo(UserStatus.ACTIVE);
    }

    @Test
    void unknownReportAndBadFiltersAreRejected() {
        assertThatThrownBy(() -> service.resolveReport(admin, UUID.randomUUID(), new ResolveRequest(ResolveAction.DISMISS, null))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.reports("BOGUS", 0, 10)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.users(null, "BOGUS", 0, 10)).isInstanceOf(ApiException.class);
    }
}
