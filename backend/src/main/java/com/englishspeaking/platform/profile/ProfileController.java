package com.englishspeaking.platform.profile;

import com.englishspeaking.platform.profile.ProfileDtos.ProfileRequest;
import com.englishspeaking.platform.profile.ProfileDtos.ProfileResponse;
import com.englishspeaking.platform.security.AuthPrincipal;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/profile")
public class ProfileController {
    private final ProfileService service;

    public ProfileController(ProfileService service) { this.service = service; }

    @GetMapping
    public ProfileResponse get(@AuthenticationPrincipal AuthPrincipal me) { return service.get(me.userId()); }

    @PutMapping
    public ProfileResponse update(@AuthenticationPrincipal AuthPrincipal me, @Valid @RequestBody ProfileRequest req) {
        return service.update(me.userId(), req);
    }

    @PostMapping("/onboarding")
    public ProfileResponse onboarding(@AuthenticationPrincipal AuthPrincipal me, @Valid @RequestBody ProfileRequest req) {
        return service.completeOnboarding(me.userId(), req);
    }
}
