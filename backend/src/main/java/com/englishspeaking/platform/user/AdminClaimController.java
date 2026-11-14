package com.englishspeaking.platform.user;

import com.englishspeaking.platform.security.AuthPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** First-admin setup (see {@link AdminClaimService}). Needs a signed-in account; it is not under /api/admin because nobody is an admin yet. */
@RestController
@RequestMapping("/api/setup")
public class AdminClaimController {
    public record ClaimRequest(@NotBlank @Size(max = 200) String token) {}

    private final AdminClaimService service;

    public AdminClaimController(AdminClaimService service) { this.service = service; }

    @PostMapping("/claim-admin")
    public ResponseEntity<Void> claim(@AuthenticationPrincipal AuthPrincipal me, @Valid @RequestBody ClaimRequest req) {
        service.claim(me.userId(), req.token());
        return ResponseEntity.noContent().build();
    }
}
