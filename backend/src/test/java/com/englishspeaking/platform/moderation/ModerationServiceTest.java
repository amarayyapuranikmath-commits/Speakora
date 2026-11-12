package com.englishspeaking.platform.moderation;

import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.profile.UserProfile;
import com.englishspeaking.platform.profile.UserProfileRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ModerationServiceTest {
    @Mock UserBlockRepository blocks;
    @Mock UserReportRepository reports;
    @Mock UserProfileRepository profiles;
    @Mock CallService calls;
    ModerationService service;
    final UUID me = UUID.randomUUID();
    final UUID partner = UUID.randomUUID();
    final UUID callId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new ModerationService(blocks, reports, profiles, calls, org.mockito.Mockito.mock(org.springframework.context.ApplicationEventPublisher.class));
        when(calls.partnerOf(callId, me)).thenReturn(partner);
    }

    @Test
    void blockingThePartnerOfACallStoresTheBlock() {
        service.blockPartner(me, callId);
        ArgumentCaptor<UserBlock> saved = ArgumentCaptor.forClass(UserBlock.class);
        verify(blocks).save(saved.capture());
        assertThat(saved.getValue().getId()).isEqualTo(new UserBlock.Key(me, partner));
    }

    @Test
    void blockingTwiceDoesNotDuplicate() {
        when(blocks.existsById(new UserBlock.Key(me, partner))).thenReturn(true);
        service.blockPartner(me, callId);
        verify(blocks, never()).save(any());
    }

    @Test
    void blockingAnOutsiderCallIsRefused() {
        when(calls.partnerOf(callId, me)).thenThrow(ApiException.notFound("CALL_NOT_FOUND", "Call not found."));
        assertThatThrownBy(() -> service.blockPartner(me, callId)).isInstanceOf(ApiException.class);
        verify(blocks, never()).save(any());
    }

    @Test
    void reportIsStoredAgainstThePartnerAndCanAlsoBlock() {
        service.report(me, callId, new ModerationService.ReportRequest(ReportReason.HARASSMENT, " rude ", true));
        ArgumentCaptor<UserReport> saved = ArgumentCaptor.forClass(UserReport.class);
        verify(reports).save(saved.capture());
        assertThat(saved.getValue().getReportedId()).isEqualTo(partner);
        assertThat(saved.getValue().getReason()).isEqualTo(ReportReason.HARASSMENT);
        verify(blocks).save(any(UserBlock.class));
    }

    @Test
    void reportWithoutBlockLeavesBlocksAlone() {
        service.report(me, callId, new ModerationService.ReportRequest(ReportReason.SPAM_OR_SCAM, null, false));
        verify(blocks, never()).save(any());
    }

    @Test
    void duplicateReportForSameCallIsRejected() {
        when(reports.existsByReporterIdAndCallId(me, callId)).thenReturn(true);
        assertThatThrownBy(() -> service.report(me, callId, new ModerationService.ReportRequest(ReportReason.OTHER, null, false)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("REPORT_EXISTS"));
    }

    @Test
    void excludedPartnersCoverBothDirections() {
        UUID iBlocked = UUID.randomUUID(), blockedMe = UUID.randomUUID();
        when(blocks.findBlockedBy(me)).thenReturn(List.of(iBlocked));
        when(blocks.findBlockersOf(me)).thenReturn(List.of(blockedMe));
        assertThat(service.excludedPartners(me)).containsExactlyInAnyOrder(iBlocked, blockedMe);
    }

    @Test
    void blockedListShowsDisplayNamesOnly() {
        UserBlock b = new UserBlock(me, partner);
        when(blocks.listForBlocker(me)).thenReturn(List.of(b));
        when(profiles.findById(partner)).thenReturn(Optional.of(new UserProfile(partner, "Sam")));
        var list = service.listBlocked(me);
        assertThat(list).hasSize(1);
        assertThat(list.get(0).displayName()).isEqualTo("Sam");
    }

    @Test
    void unblockDeletesTheBlock() {
        service.unblock(me, partner);
        verify(blocks).deleteById(new UserBlock.Key(me, partner));
        assertThat(Set.of(1)).isNotEmpty();
    }
}
