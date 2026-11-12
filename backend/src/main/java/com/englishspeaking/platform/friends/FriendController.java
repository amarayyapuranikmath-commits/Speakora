package com.englishspeaking.platform.friends;

import com.englishspeaking.platform.moderation.ModerationService;
import com.englishspeaking.platform.security.AuthPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

@RestController
@RequestMapping("/api/friends")
public class FriendController {
    public record AddRequest(@NotBlank @Size(max = 64) String partnerRef) {}

    public record SendMessage(@NotBlank @Size(max = MessageService.MAX_LENGTH) String body) {}

    private final FriendService friends;
    private final MessageService messages;

    public FriendController(FriendService friends, MessageService messages) {
        this.friends = friends;
        this.messages = messages;
    }

    @GetMapping
    public ResponseEntity<FriendService.Overview> overview(@AuthenticationPrincipal AuthPrincipal me) {
        return noStore(friends.overview(me.userId()));
    }

    @PostMapping("/requests")
    public ResponseEntity<Void> add(@AuthenticationPrincipal AuthPrincipal me, @Valid @RequestBody AddRequest req) {
        friends.sendRequest(me.userId(), req.partnerRef());
        return ResponseEntity.status(201).build();
    }

    @PostMapping("/requests/{id}/accept")
    public ResponseEntity<Void> accept(@AuthenticationPrincipal AuthPrincipal me, @PathVariable UUID id) {
        friends.accept(me.userId(), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/requests/{id}/decline")
    public ResponseEntity<Void> decline(@AuthenticationPrincipal AuthPrincipal me, @PathVariable UUID id) {
        friends.decline(me.userId(), id);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/requests/{id}")
    public ResponseEntity<Void> cancel(@AuthenticationPrincipal AuthPrincipal me, @PathVariable UUID id) {
        friends.cancel(me.userId(), id);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{ref}")
    public ResponseEntity<Void> remove(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String ref) {
        friends.remove(me.userId(), ref);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{ref}/block")
    public ResponseEntity<Void> block(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String ref) {
        friends.block(me.userId(), ref);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{ref}/report")
    public ResponseEntity<Void> report(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String ref,
                                       @Valid @RequestBody ModerationService.ReportRequest req) {
        friends.report(me.userId(), ref, req);
        return ResponseEntity.status(201).build();
    }

    // ---- messages

    @GetMapping("/{ref}/messages")
    public ResponseEntity<MessageService.Page> list(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String ref,
                                                    @RequestParam(required = false) Instant before) {
        return noStore(messages.list(me.userId(), ref, before));
    }

    @PostMapping("/{ref}/messages")
    public ResponseEntity<MessageService.MessageView> send(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String ref,
                                                           @Valid @RequestBody SendMessage req) {
        return ResponseEntity.status(201).body(messages.send(me.userId(), ref, req.body()));
    }

    @PostMapping("/{ref}/messages/read")
    public ResponseEntity<Void> read(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String ref) {
        messages.markRead(me.userId(), ref);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{ref}/messages")
    public ResponseEntity<Void> clear(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String ref) {
        messages.clear(me.userId(), ref);
        return ResponseEntity.noContent().build();
    }

    private static <T> ResponseEntity<T> noStore(T body) { return ResponseEntity.ok().header("Cache-Control", "no-store").body(body); }
}
