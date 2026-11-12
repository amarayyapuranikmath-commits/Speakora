package com.englishspeaking.platform.topics;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/topics")
public class TopicController {
    private final TopicService service;

    public TopicController(TopicService service) { this.service = service; }

    @GetMapping
    public List<TopicService.TopicDto> list() { return service.listActive(); }
}
