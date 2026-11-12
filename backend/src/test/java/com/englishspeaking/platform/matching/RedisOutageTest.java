package com.englishspeaking.platform.matching;

import com.englishspeaking.platform.TestSupport;
import com.englishspeaking.platform.calling.CallEvents;
import com.englishspeaking.platform.calling.CallService;
import com.englishspeaking.platform.calling.CallStatus;
import com.englishspeaking.platform.calling.EndReason;
import com.englishspeaking.platform.moderation.ModerationService;
import com.englishspeaking.platform.preferences.UserPreferencesRepository;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.englishspeaking.platform.topics.TopicService;
import com.englishspeaking.platform.user.AccountService;
import com.englishspeaking.platform.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.redis.RedisConnectionFailureException;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

/** A Redis outage must never roll back database work (call endings, account deletion) that publishes events. */
class RedisOutageTest {
    private final MatchmakingStore store = mock(MatchmakingStore.class);
    private final MatchmakingService service = new MatchmakingService(store, mock(UserRepository.class), mock(UserProfileRepository.class),
            mock(UserPreferencesRepository.class), mock(TopicService.class), mock(ModerationService.class), mock(CallService.class),
            mock(ApplicationEventPublisher.class), new TestSupport.MutableClock(Instant.parse("2026-11-09T10:00:00Z")));

    @Test
    void endingACallSurvivesRedisBeingDown() {
        doThrow(new RedisConnectionFailureException("down")).when(store).releaseCall(any(), any());
        UUID a = UUID.randomUUID(), b = UUID.randomUUID(), call = UUID.randomUUID();
        assertThatCode(() -> service.onCallStateChanged(new CallEvents.StateChanged(call, CallStatus.COMPLETED, EndReason.ENDED, a, 60, List.of(a, b))))
                .doesNotThrowAnyException();
    }

    @Test
    void deletingAnAccountSurvivesRedisBeingDown() {
        doThrow(new RedisConnectionFailureException("down")).when(store).remove(any());
        assertThatCode(() -> service.onAccountDeleted(new AccountService.AccountDeletedEvent(UUID.randomUUID()))).doesNotThrowAnyException();
    }
}
