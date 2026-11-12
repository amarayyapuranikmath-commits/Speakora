package com.englishspeaking.platform.partners;

import com.englishspeaking.platform.security.AuthPrincipal;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/partners")
public class PartnerController {
    private final PartnerService partners;

    public PartnerController(PartnerService partners) { this.partners = partners; }

    /** Previous partners with their current availability. Reconnecting itself goes through the signalling socket. */
    @GetMapping
    public ResponseEntity<List<PartnerService.PartnerSummary>> list(@AuthenticationPrincipal AuthPrincipal me) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(partners.list(me.userId()));
    }
}
