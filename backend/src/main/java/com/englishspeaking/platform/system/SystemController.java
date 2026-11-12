package com.englishspeaking.platform.system;

import com.englishspeaking.platform.security.AuthPrincipal;
import com.englishspeaking.platform.user.UserRepository;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Admin-only (SecurityConfig: /api/admin/**). */
@RestController
@RequestMapping("/api/admin/system")
public class SystemController {
    private final SystemService system;
    private final UserRepository users;

    public SystemController(SystemService system, UserRepository users) {
        this.system = system;
        this.users = users;
    }

    @GetMapping
    public SystemService.Report report(@AuthenticationPrincipal AuthPrincipal me) { return system.report(me.userId()); }

    /** Sends to the administrator's own address unless another one is given. */
    @PostMapping("/test-email")
    public SystemService.Check testEmail(@AuthenticationPrincipal AuthPrincipal me, @RequestParam(required = false) String to) {
        if (to != null && !to.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) throw SystemService.badRecipient();
        if (to == null) to = users.findById(me.userId()).map(u -> u.getEmail()).orElseThrow(SystemService::badRecipient);
        return system.testEmail(to);
    }

    @PostMapping("/test-coach")
    public SystemService.Check testCoach() { return system.testCoach(); }

    @PostMapping("/test-turn")
    public SystemService.Check testTurn(@AuthenticationPrincipal AuthPrincipal me) { return system.testTurn(me.userId()); }
}
