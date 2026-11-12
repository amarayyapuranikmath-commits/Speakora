package com.englishspeaking.platform.moderation;

import com.englishspeaking.platform.common.PageResponse;
import com.englishspeaking.platform.security.AuthPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/** Restricted to ROLE_ADMIN in SecurityConfig. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final AdminService admin;

    public AdminController(AdminService admin) { this.admin = admin; }

    @GetMapping("/reports")
    public PageResponse<AdminService.ReportRow> reports(@RequestParam(defaultValue = "OPEN") String status,
                                                        @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return admin.reports(status, page, size);
    }

    @PostMapping("/reports/{id}/resolve")
    public ResponseEntity<Void> resolve(@AuthenticationPrincipal AuthPrincipal me, @PathVariable UUID id, @Valid @RequestBody AdminService.ResolveRequest req) {
        admin.resolveReport(me.userId(), id, req);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/users")
    public PageResponse<AdminService.UserRow> users(@RequestParam(required = false) String q, @RequestParam(defaultValue = "ALL") String status,
                                                    @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return admin.users(q, status, page, size);
    }

    @PostMapping("/users/{id}/suspend")
    public ResponseEntity<Void> suspend(@AuthenticationPrincipal AuthPrincipal me, @PathVariable UUID id, @Valid @RequestBody AdminService.SuspendRequest req) {
        admin.suspend(me.userId(), id, req.reason());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/users/{id}/unsuspend")
    public ResponseEntity<Void> unsuspend(@AuthenticationPrincipal AuthPrincipal me, @PathVariable UUID id) {
        admin.unsuspend(me.userId(), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/users/{id}/history")
    public List<AdminService.ActionRow> history(@PathVariable UUID id) { return admin.history(id); }
}
