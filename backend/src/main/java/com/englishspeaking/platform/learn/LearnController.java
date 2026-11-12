package com.englishspeaking.platform.learn;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.learn.Curriculum.Subject;
import com.englishspeaking.platform.security.AuthPrincipal;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/learn")
public class LearnController {
    public record Answers(List<LearnService.AnswerIn> answers) {}

    public record CheckRequest(@NotNull String id, String answer) {}

    public record SavedRequest(boolean saved) {}

    private final LearnService learn;

    public LearnController(LearnService learn) { this.learn = learn; }

    @GetMapping("/overview")
    public ResponseEntity<LearnService.Overview> overview(@AuthenticationPrincipal AuthPrincipal me) { return noStore(learn.overview(me.userId())); }

    @GetMapping("/grammar/levels/{level}")
    public ResponseEntity<LearnService.LevelView> grammar(@AuthenticationPrincipal AuthPrincipal me, @PathVariable int level) { return noStore(learn.grammarLevel(me.userId(), level)); }

    @GetMapping("/phrasal/levels/{level}")
    public ResponseEntity<LearnService.LevelView> phrasal(@AuthenticationPrincipal AuthPrincipal me, @PathVariable int level) { return noStore(learn.phrasalLevel(me.userId(), level)); }

    @GetMapping("/vocabulary/levels/{level}")
    public ResponseEntity<LearnService.VocabularyLevelView> vocabulary(@AuthenticationPrincipal AuthPrincipal me, @PathVariable int level) { return noStore(learn.vocabularyLevel(me.userId(), level)); }

    @GetMapping("/vocabulary/words/{id}")
    public ResponseEntity<LearnService.WordView> word(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String id) { return noStore(learn.word(me.userId(), id)); }

    @GetMapping("/vocabulary/themes")
    public ResponseEntity<List<LearnService.ThemeSummary>> vocabularyThemes(@AuthenticationPrincipal AuthPrincipal me) { return noStore(learn.themes(me.userId(), Subject.VOCABULARY)); }

    @GetMapping("/vocabulary/themes/{theme}")
    public ResponseEntity<LearnService.ThemeWords> vocabularyTheme(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String theme) { return noStore(learn.vocabularyTheme(me.userId(), theme)); }

    @GetMapping("/phrasal/themes")
    public ResponseEntity<List<LearnService.ThemeSummary>> phrasalThemes(@AuthenticationPrincipal AuthPrincipal me) { return noStore(learn.themes(me.userId(), Subject.PHRASAL)); }

    @GetMapping("/phrasal/themes/{theme}")
    public ResponseEntity<LearnService.ThemeVerbs> phrasalTheme(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String theme) { return noStore(learn.phrasalTheme(me.userId(), theme)); }

    // ---- the daily lesson

    /** Today's lesson, chosen from the fixed course sequence. The same lesson is returned until it is finished. */
    @GetMapping("/today")
    public ResponseEntity<LearnService.DailyPlanView> today(@AuthenticationPrincipal AuthPrincipal me) { return noStore(learn.today(me.userId())); }

    /** Another lesson today, once the current one is finished. */
    @PostMapping("/today/more")
    public LearnService.DailyPlanView more(@AuthenticationPrincipal AuthPrincipal me) { return learn.learnMore(me.userId()); }

    @PostMapping("/today/speaking")
    public LearnService.DailyPlanView speaking(@AuthenticationPrincipal AuthPrincipal me) { return learn.speakingDone(me.userId()); }

    @GetMapping("/today/practice/{part}")
    public ResponseEntity<LearnService.Quiz> dailyPractice(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String part) { return noStore(learn.dailyPractice(me.userId(), part)); }

    @PostMapping("/today/practice/{part}")
    public LearnService.Outcome submitDailyPractice(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String part, @RequestBody Answers body) {
        return learn.submitDailyPractice(me.userId(), part, body.answers());
    }

    @GetMapping("/lessons/{id}")
    public ResponseEntity<Object> lesson(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String id) { return noStore(learn.lesson(me.userId(), id)); }

    /** Practice feedback for one exercise. Records nothing. */
    @PostMapping("/check")
    public LearnService.CheckResult check(@AuthenticationPrincipal AuthPrincipal me, @RequestBody CheckRequest req) { return learn.check(req.id(), req.answer()); }

    @PostMapping("/lessons/{id}/assessment")
    public LearnService.Outcome submitLesson(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String id, @RequestBody Answers body) {
        return learn.submitLesson(me.userId(), id, body.answers());
    }

    @GetMapping("/tests/{subject}/{level}")
    public ResponseEntity<LearnService.Quiz> levelTest(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String subject, @PathVariable int level) {
        return noStore(learn.levelTest(subject(subject), level));
    }

    @PostMapping("/tests/{subject}/{level}")
    public LearnService.Outcome submitLevelTest(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String subject, @PathVariable int level, @RequestBody Answers body) {
        return learn.submitLevelTest(me.userId(), subject(subject), level, body.answers());
    }

    @PutMapping("/items/{id}/saved")
    public LearnService.ItemRow save(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String id, @RequestBody SavedRequest body) {
        return learn.setSaved(me.userId(), id, body.saved());
    }

    @GetMapping("/collections/{type}")
    public ResponseEntity<List<LearnService.ItemRow>> collection(@AuthenticationPrincipal AuthPrincipal me, @PathVariable String type, @RequestParam(required = false) String subject) {
        if (!type.equals("saved") && !type.equals("difficult")) throw ApiException.notFound("COLLECTION_NOT_FOUND", "That collection does not exist.");
        return noStore(learn.collection(me.userId(), kind(subject), type));
    }

    @GetMapping("/revision")
    public ResponseEntity<LearnService.Quiz> revision(@AuthenticationPrincipal AuthPrincipal me, @RequestParam(required = false) String subject) {
        return noStore(learn.revision(me.userId(), kind(subject)));
    }

    @PostMapping("/revision")
    public LearnService.Outcome submitRevision(@AuthenticationPrincipal AuthPrincipal me, @RequestBody Answers body) { return learn.submitRevision(me.userId(), body.answers()); }

    @GetMapping("/progress")
    public ResponseEntity<LearnService.Progress> progress(@AuthenticationPrincipal AuthPrincipal me) { return noStore(learn.progress(me.userId())); }

    private static String kind(String subject) {
        if (subject == null) return null;
        return subject(subject) == Subject.PHRASAL ? "PHRASAL" : "VOCABULARY";
    }

    private static Subject subject(String s) {
        return switch (s.toLowerCase()) {
            case "grammar" -> Subject.GRAMMAR;
            case "vocabulary" -> Subject.VOCABULARY;
            case "phrasal" -> Subject.PHRASAL;
            default -> throw ApiException.notFound("SUBJECT_NOT_FOUND", "That subject does not exist.");
        };
    }

    private static <T> ResponseEntity<T> noStore(T body) { return ResponseEntity.ok().header("Cache-Control", "no-store").body(body); }
}
