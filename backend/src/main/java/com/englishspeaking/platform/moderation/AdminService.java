package com.englishspeaking.platform.moderation;

import com.englishspeaking.platform.auth.RefreshTokenRepository;
import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.calling.EndReason;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.common.PageResponse;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.security.RevokedSessions;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import com.englishspeaking.platform.user.UserStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** Moderator operations. Every decision is written to the append-only moderation_actions table. */
@Service
public class AdminService {
    public enum ResolveAction { DISMISS, SUSPEND }

    public record ResolveRequest(@NotNull ResolveAction action, @Size(max = 500) String note) {}

    public record SuspendRequest(@NotBlank @Size(max = 500) String reason) {}

    public record ReportRow(UUID id, Instant createdAt, String status, ReportReason reason, String details, UUID callId,
                            String reporterName, UUID reportedUserId, String reportedName, UserStatus reportedStatus,
                            long openReportsAgainst, long totalReportsAgainst, String resolutionNote, Instant resolvedAt) {}

    public record UserRow(UUID id, String email, String displayName, UserStatus status, String role, Instant createdAt,
                          String suspendedReason, long openReportsAgainst, long totalReportsAgainst) {}

    public record ActionRow(ModerationAction.Type action, String reason, Instant createdAt) {}

    private final UserRepository users;
    private final UserProfileRepository profiles;
    private final UserReportRepository reports;
    private final ModerationActionRepository actions;
    private final RefreshTokenRepository refreshTokens;
    private final CallService calls;
    private final RevokedSessions revoked;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public AdminService(UserRepository users, UserProfileRepository profiles, UserReportRepository reports, ModerationActionRepository actions,
                        RefreshTokenRepository refreshTokens, CallService calls, RevokedSessions revoked, ApplicationEventPublisher events, Clock clock) {
        this.users = users;
        this.profiles = profiles;
        this.reports = reports;
        this.actions = actions;
        this.refreshTokens = refreshTokens;
        this.calls = calls;
        this.revoked = revoked;
        this.events = events;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public PageResponse<ReportRow> reports(String status, int page, int size) {
        String filter = (status == null || status.isBlank() || status.equalsIgnoreCase("ALL")) ? null : status.toUpperCase();
        if (filter != null && !Set.of(UserReport.OPEN, UserReport.ACTIONED, UserReport.DISMISSED).contains(filter)) {
            throw ApiException.badRequest("INVALID_STATUS", "Unknown report status.");
        }
        Page<UserReport> result = reports.findByStatus(filter, PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 50)));
        Set<UUID> ids = result.getContent().stream().flatMap(r -> Stream.of(r.getReporterId(), r.getReportedId())).collect(Collectors.toSet());
        Map<UUID, String> names = names(ids);
        Map<UUID, User> reported = users.findAllById(result.getContent().stream().map(UserReport::getReportedId).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(User::getId, u -> u));
        return PageResponse.of(result, result.getContent().stream().map(r -> new ReportRow(r.getId(), r.getCreatedAt(), r.getStatus(), r.getReason(),
                r.getDetails(), r.getCallId(), names.getOrDefault(r.getReporterId(), "Deleted user"), r.getReportedId(),
                names.getOrDefault(r.getReportedId(), "Deleted user"), reported.get(r.getReportedId()) == null ? null : reported.get(r.getReportedId()).getStatus(),
                reports.countByReportedIdAndStatus(r.getReportedId(), UserReport.OPEN), reports.countByReportedId(r.getReportedId()),
                r.getResolutionNote(), r.getResolvedAt())).toList());
    }

    @Transactional
    public void resolveReport(UUID adminId, UUID reportId, ResolveRequest req) {
        UserReport report = reports.findById(reportId).orElseThrow(() -> ApiException.notFound("REPORT_NOT_FOUND", "Report not found."));
        String note = clean(req.note());
        if (req.action() == ResolveAction.SUSPEND) {
            report.resolve(UserReport.ACTIONED, adminId, note, clock.instant()); // rejects an already-resolved report before anything else happens
            suspendUser(adminId, report.getReportedId(), note != null ? note : "Report: " + report.getReason(), report.getId());
            actions.save(new ModerationAction(adminId, report.getReportedId(), ModerationAction.Type.ACTION_REPORT, note, report.getId()));
        } else {
            report.resolve(UserReport.DISMISSED, adminId, note, clock.instant());
            actions.save(new ModerationAction(adminId, report.getReportedId(), ModerationAction.Type.DISMISS_REPORT, note, report.getId()));
        }
    }

    @Transactional(readOnly = true)
    public PageResponse<UserRow> users(String q, String status, int page, int size) {
        UserStatus filter = null;
        if (status != null && !status.isBlank() && !status.equalsIgnoreCase("ALL")) {
            try {
                filter = UserStatus.valueOf(status.toUpperCase());
            } catch (IllegalArgumentException e) {
                throw ApiException.badRequest("INVALID_STATUS", "Unknown user status.");
            }
        }
        String query = q == null || q.isBlank() ? null : q.trim();
        Page<User> result = users.search(query, filter, PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 50)));
        Map<UUID, String> names = names(result.getContent().stream().map(User::getId).collect(Collectors.toSet()));
        return PageResponse.of(result, result.getContent().stream().map(u -> new UserRow(u.getId(), u.getEmail(), names.getOrDefault(u.getId(), ""),
                u.getStatus(), u.getRole(), u.getCreatedAt(), u.getSuspendedReason(),
                reports.countByReportedIdAndStatus(u.getId(), UserReport.OPEN), reports.countByReportedId(u.getId()))).toList());
    }

    @Transactional
    public void suspend(UUID adminId, UUID userId, String reason) {
        suspendUser(adminId, userId, clean(reason), null);
    }

    @Transactional
    public void unsuspend(UUID adminId, UUID userId) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("USER_NOT_FOUND", "User not found."));
        if (user.getStatus() != UserStatus.SUSPENDED) throw ApiException.conflict("NOT_SUSPENDED", "This account is not suspended.");
        user.setStatus(UserStatus.ACTIVE);
        user.setSuspendedReason(null);
        revoked.unblock(userId);
        actions.save(new ModerationAction(adminId, userId, ModerationAction.Type.UNSUSPEND, null, null));
    }

    @Transactional(readOnly = true)
    public List<ActionRow> history(UUID userId) {
        return actions.findTop10ByTargetUserIdOrderByCreatedAtDesc(userId).stream().map(a -> new ActionRow(a.getAction(), a.getReason(), a.getCreatedAt())).toList();
    }

    private void suspendUser(UUID adminId, UUID userId, String reason, UUID reportId) {
        if (adminId.equals(userId)) throw ApiException.badRequest("SELF_SUSPEND", "You cannot suspend your own account.");
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("USER_NOT_FOUND", "User not found."));
        if (user.isAdmin()) throw ApiException.forbidden("ADMIN_PROTECTED", "Administrators cannot be suspended here.");
        if (user.getStatus() == UserStatus.DELETED) throw ApiException.badRequest("USER_DELETED", "This account has been deleted.");
        if (user.getStatus() == UserStatus.SUSPENDED) throw ApiException.conflict("ALREADY_SUSPENDED", "This account is already suspended.");
        user.setStatus(UserStatus.SUSPENDED);
        user.setSuspendedReason(reason);
        refreshTokens.revokeAllForUser(userId, clock.instant());       // no new access tokens
        calls.activeCallOf(userId).ifPresent(c -> calls.end(c.getId(), userId, EndReason.ENDED)); // partner is not left hanging
        revoked.block(userId);                                          // existing access tokens stop working now
        events.publishEvent(new UserSuspendedEvent(userId));            // leave the queue, close the socket
        if (reportId == null) actions.save(new ModerationAction(adminId, userId, ModerationAction.Type.SUSPEND, reason, null));
        else actions.save(new ModerationAction(adminId, userId, ModerationAction.Type.SUSPEND, reason, reportId));
    }

    private Map<UUID, String> names(Collection<UUID> ids) {
        return profiles.findAllById(ids).stream().collect(Collectors.toMap(UserProfile::getUserId, UserProfile::getDisplayName));
    }

    private static String clean(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
