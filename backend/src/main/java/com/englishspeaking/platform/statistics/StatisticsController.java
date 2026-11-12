package com.englishspeaking.platform.statistics;

import com.englishspeaking.platform.security.AuthPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/stats")
public class StatisticsController {
    private final StatisticsService service;

    public StatisticsController(StatisticsService service) { this.service = service; }

    @GetMapping("/summary")
    public StatisticsService.Summary summary(@AuthenticationPrincipal AuthPrincipal me) { return service.summary(me.userId()); }

    @GetMapping("/activity")
    public List<StatisticsService.DayPoint> activity(@AuthenticationPrincipal AuthPrincipal me,
                                                     @RequestParam(defaultValue = "30") int days) {
        return service.activity(me.userId(), Math.min(Math.max(days, 1), 90));
    }
}
