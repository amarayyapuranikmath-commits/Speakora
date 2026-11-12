package com.englishspeaking.platform.moderation;

import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Blocking and reporting. Partners are always identified through a shared call so user ids are never exposed. */
@Service
public class ModerationService {
    public record ReportRequest(@NotNull ReportReason reason, @Size(max = 1000) String details, boolean alsoBlock) {}

    public record BlockedUser(UUID userId, String displayName, Instant blockedAt) {}

    private final UserBlockRepository blocks;
    private final UserReportRepository reports;
    private final UserProfileRepository profiles;
    private final CallService calls;
    private final org.springframework.context.ApplicationEventPublisher events;

    public ModerationService(UserBlockRepository blocks, UserReportRepository reports, UserProfileRepository profiles, CallService calls,
                             org.springframework.context.ApplicationEventPublisher events) {
        this.blocks = blocks;
        this.reports = reports;
        this.profiles = profiles;
        this.calls = calls;
        this.events = events;
    }

    @Transactional
    public void blockPartner(UUID me, UUID callId) { block(me, calls.partnerOf(callId, me)); }

    /** Blocks someone the caller already knows (for example a friend). Ends the friendship and every open request between them. */
    @Transactional
    public void blockUser(UUID me, UUID other) { block(me, other); }

    /** Reports a friend; there is no call to point at, so the report carries only the reason and the details written by the reporter. */
    @Transactional
    public void reportUser(UUID me, UUID other, ReportRequest req) {
        if (me.equals(other)) throw ApiException.badRequest("SELF_REPORT", "You cannot report yourself.");
        String details = req.details() == null || req.details().isBlank() ? null : req.details().trim();
        reports.save(new UserReport(me, other, null, req.reason(), details));
        if (req.alsoBlock()) block(me, other);
    }

    /** True if either person has blocked the other. */
    @Transactional(readOnly = true)
    public boolean isBlockedEitherWay(UUID a, UUID b) { return excludedPartners(a).contains(b); }

    @Transactional
    public void report(UUID me, UUID callId, ReportRequest req) {
        UUID partner = calls.partnerOf(callId, me);
        if (reports.existsByReporterIdAndCallId(me, callId)) {
            throw ApiException.conflict("REPORT_EXISTS", "You have already reported this call.");
        }
        String details = req.details() == null || req.details().isBlank() ? null : req.details().trim();
        reports.save(new UserReport(me, partner, callId, req.reason(), details));
        if (req.alsoBlock()) block(me, partner);
    }

    @Transactional
    public void unblock(UUID me, UUID blockedId) {
        blocks.deleteById(new UserBlock.Key(me, blockedId));
    }

    @Transactional(readOnly = true)
    public List<BlockedUser> listBlocked(UUID me) {
        return blocks.listForBlocker(me).stream().map(b -> new BlockedUser(b.getId().blockedId(),
                profiles.findById(b.getId().blockedId()).map(UserProfile::getDisplayName).orElse("Deleted user"), b.getCreatedAt())).toList();
    }

    /** Everyone this user must never be matched with: people they blocked and people who blocked them. */
    @Transactional(readOnly = true)
    public Set<UUID> excludedPartners(UUID me) {
        Set<UUID> ids = new HashSet<>(blocks.findBlockedBy(me));
        ids.addAll(blocks.findBlockersOf(me));
        return ids;
    }

    private void block(UUID me, UUID target) {
        if (me.equals(target)) throw ApiException.badRequest("SELF_BLOCK", "You cannot block yourself.");
        UserBlock.Key key = new UserBlock.Key(me, target);
        if (!blocks.existsById(key)) blocks.save(new UserBlock(me, target));
        events.publishEvent(new UserBlockedEvent(me, target));
    }
}
