package com.englishspeaking.platform.moderation;

import com.englishspeaking.platform.security.AuthPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class ModerationController {
    private final ModerationService service;

    public ModerationController(ModerationService service) { this.service = service; }

    @PostMapping("/calls/{callId}/block-partner")
    public ResponseEntity<Void> block(@AuthenticationPrincipal AuthPrincipal me, @PathVariable UUID callId) {
        service.blockPartner(me.userId(), callId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/calls/{callId}/report")
    public ResponseEntity<Void> report(@AuthenticationPrincipal AuthPrincipal me, @PathVariable UUID callId,
                                       @Valid @RequestBody ModerationService.ReportRequest req) {
        service.report(me.userId(), callId, req);
        return ResponseEntity.status(201).build();
    }

    @GetMapping("/blocks")
    public List<ModerationService.BlockedUser> blocked(@AuthenticationPrincipal AuthPrincipal me) {
        return service.listBlocked(me.userId());
    }

    @DeleteMapping("/blocks/{blockedUserId}")
    public ResponseEntity<Void> unblock(@AuthenticationPrincipal AuthPrincipal me, @PathVariable UUID blockedUserId) {
        service.unblock(me.userId(), blockedUserId);
        return ResponseEntity.noContent().build();
    }
}
