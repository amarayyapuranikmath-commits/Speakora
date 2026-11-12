package com.englishspeaking.platform;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.learn.Curriculum;
import com.englishspeaking.platform.learn.LearnService;
import com.englishspeaking.platform.learn.LearnService.AnswerIn;
import com.englishspeaking.platform.matching.MatchmakingStore;
import com.englishspeaking.platform.user.User;
import com.englishspeaking.platform.user.UserRepository;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Lessons, tests, spaced revision and progress against the real PostgreSQL test database (real migration V7). Every test rolls back. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Transactional
class LearnFlowIntegrationTest {
    private static final String URL = "jdbc:postgresql://localhost:5432/english_speaking_test";
    private static String password;

    @BeforeAll
    static void requireTestDatabase() {
        try {
            Matcher m = Pattern.compile("(?m)^DB_PASSWORD=([^\\r\\n]*)$").matcher(Files.readString(Path.of("../.env")));
            Assumptions.assumeTrue(m.find(), "no DB_PASSWORD in ../.env");
            password = m.group(1).trim();
            try (var c = DriverManager.getConnection(URL, "esp_app", password)) { c.isValid(2); }
        } catch (Exception e) {
            Assumptions.abort("PostgreSQL test database not reachable: " + e.getClass().getSimpleName());
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> URL);
        registry.add("spring.datasource.username", () -> "esp_app");
        registry.add("spring.datasource.password", () -> password);
    }

    @MockitoBean MatchmakingStore store;
    @Autowired UserRepository users;
    @Autowired LearnService learn;
    @Autowired Curriculum curriculum;

    private UUID person() {
        User u = new User("learn." + UUID.randomUUID() + "@it.example.com", "hash", LocalDate.of(1990, 1, 1));
        users.saveAndFlush(u);
        return u.getId();
    }

    /** Answers every assessment question of a lesson correctly (or all wrongly). */
    private List<AnswerIn> assessmentAnswers(String lessonId, boolean right) {
        List<Curriculum.Question> qs = curriculum.grammarLesson(lessonId).map(Curriculum.GrammarLesson::assessment)
                .orElseGet(() -> curriculum.phrasalLesson(lessonId).orElseThrow().assessment());
        List<AnswerIn> out = new ArrayList<>();
        for (Curriculum.Question q : qs) out.add(new AnswerIn(q.id(), right ? q.correctAnswer() : "definitely wrong"));
        return out;
    }

    @Test
    void aNewLearnerStartsAtTheFirstLessonWithNothingRecorded() {
        UUID me = person();
        LearnService.Overview o = learn.overview(me);
        assertThat(o.subjects()).extracting(LearnService.SubjectSummary::id).containsExactly("grammar", "vocabulary", "phrasal");
        assertThat(o.subjects()).allSatisfy(s -> assertThat(s.completed()).isZero());
        assertThat(o.subjects().get(0).total()).isEqualTo(67);
        assertThat(o.next().lessonId()).isEqualTo("g1.01");
        assertThat(o.dueCount()).isZero();
        LearnService.Progress p = learn.progress(me);
        assertThat(p.averagePercent()).isNull();
        assertThat(p.recent()).isEmpty();
        assertThat(p.learningStreakDays()).isZero();
        assertThat(p.weakTopics()).isEmpty();
    }

    @Test
    void lessonAssessmentsAreSentWithoutAnswersAndExercisesAreCheckedByTheServer() {
        UUID me = person();
        LearnService.GrammarLessonView lesson = (LearnService.GrammarLessonView) learn.lesson(me, "g1.01");
        assertThat(lesson.assessment()).hasSize(5);
        assertThat(lesson.assessment().toString()).doesNotContain("answer");
        String id = lesson.exercises().get(0).id();
        Curriculum.Question q = curriculum.question(id).orElseThrow();
        assertThat(learn.check(id, q.correctAnswer()).correct()).isTrue();
        assertThat(learn.check(id, "nonsense").correct()).isFalse();
        // An assessment answer can never be read through the practice checker.
        assertThatThrownBy(() -> learn.check("g1.01.a1", "x")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("NOT_AN_EXERCISE"));
        assertThat(learn.progress(me).recent()).isEmpty(); // practice records nothing
    }

    @Test
    void passingTheAssessmentCompletesTheLessonAndFailingDoesNot() {
        UUID me = person();
        LearnService.Outcome bad = learn.submitLesson(me, "g1.01", assessmentAnswers("g1.01", false));
        assertThat(bad.percent()).isZero();
        assertThat(bad.passed()).isFalse();
        assertThat(bad.lessonCompleted()).isFalse();
        assertThat(bad.results()).allSatisfy(r -> assertThat(r.correctAnswer()).isNotBlank());
        assertThat(learn.overview(me).subjects().get(0).completed()).isZero();
        assertThat(learn.progress(me).weakTopics()).extracting(LearnService.WeakTopic::lessonId).contains("g1.01");

        LearnService.Outcome good = learn.submitLesson(me, "g1.01", assessmentAnswers("g1.01", true));
        assertThat(good.percent()).isEqualTo(100);
        assertThat(good.lessonCompleted()).isTrue();
        assertThat(learn.submitLesson(me, "g1.01", assessmentAnswers("g1.01", true)).lessonCompleted()).as("only the first pass completes it").isFalse();

        LearnService.LevelView level = learn.grammarLevel(me, 1);
        assertThat(level.lessons().get(0).status()).isEqualTo("COMPLETED");
        assertThat(level.lessons().get(0).bestPercent()).isEqualTo(100);
        assertThat(level.lessons().get(0).attempts()).isEqualTo(3);
        assertThat(level.lessons().get(1).status()).isEqualTo("NOT_STARTED");
        LearnService.Progress p = learn.progress(me);
        assertThat(p.grammarCompleted()).isEqualTo(1);
        assertThat(p.recent()).hasSize(3);
        assertThat(p.recent().get(0).label()).isEqualTo("Basic sentence structure");
        assertThat(p.averagePercent()).isEqualTo(Math.round((0 + 100 + 100) / 3f));
        assertThat(p.learningStreakDays()).isEqualTo(1);
        assertThat(learn.overview(me).next().lessonId()).isEqualTo("g1.02");
    }

    @Test
    void aLessonCannotBeGradedWithAnotherLessonsQuestionsOrDuplicates() {
        UUID me = person();
        List<AnswerIn> other = assessmentAnswers("g1.02", true);
        assertThatThrownBy(() -> learn.submitLesson(me, "g1.01", other)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("WRONG_QUESTIONS"));
        List<AnswerIn> dup = new ArrayList<>(assessmentAnswers("g1.01", true));
        dup.add(dup.get(0));
        assertThatThrownBy(() -> learn.submitLesson(me, "g1.01", dup)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("DUPLICATE_QUESTION"));
        assertThatThrownBy(() -> learn.submitLesson(me, "g9.99", dup)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("LESSON_NOT_FOUND"));
        assertThatThrownBy(() -> learn.submitLesson(me, "g1.01", List.of())).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("NO_ANSWERS"));
        // Unanswered questions count as wrong: skipping cannot give a pass.
        LearnService.Outcome one = learn.submitLesson(me, "g1.01", assessmentAnswers("g1.01", true).subList(0, 1));
        assertThat(one.total()).isEqualTo(5);
        assertThat(one.passed()).isFalse();
    }

    @Test
    void aLevelTestIsDrawnFromRealQuestionsAndNeedsEnoughAnswers() {
        UUID me = person();
        for (Curriculum.Subject s : Curriculum.Subject.values()) {
            LearnService.Quiz quiz = learn.levelTest(s, 1);
            assertThat(quiz.questions()).hasSize(10);
            assertThat(quiz.questions().stream().map(LearnService.QuestionView::id).distinct().count()).isEqualTo(10);
        }
        LearnService.Quiz quiz = learn.levelTest(Curriculum.Subject.GRAMMAR, 1);
        List<AnswerIn> right = quiz.questions().stream().map(q -> new AnswerIn(q.id(), curriculum.question(q.id()).orElseThrow().correctAnswer())).toList();
        assertThatThrownBy(() -> learn.submitLevelTest(me, Curriculum.Subject.GRAMMAR, 1, right.subList(0, 2)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("TOO_FEW_ANSWERS"));
        assertThatThrownBy(() -> learn.submitLevelTest(me, Curriculum.Subject.GRAMMAR, 2, right))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("WRONG_QUESTIONS"));
        LearnService.Outcome o = learn.submitLevelTest(me, Curriculum.Subject.GRAMMAR, 1, right);
        assertThat(o.percent()).isEqualTo(100);
        assertThat(learn.grammarLevel(me, 1).level().testPercent()).isEqualTo(100);
        assertThat(learn.grammarLevel(me, 2).level().testPercent()).isNull();
    }

    @Test
    void savedWordsEnterRevisionAndAreLearnedAfterThreeCorrectReviews() {
        UUID me = person();
        LearnService.ItemRow saved = learn.setSaved(me, "v1.01", true);
        assertThat(saved.saved()).isTrue();
        assertThat(saved.status()).isEqualTo("LEARNING");
        assertThat(learn.collection(me, "VOCABULARY", "saved")).extracting(LearnService.ItemRow::label).containsExactly("borrow");
        assertThat(learn.overview(me).dueCount()).isEqualTo(1);

        for (int i = 1; i <= 3; i++) {
            LearnService.Quiz rev = learn.revision(me, "VOCABULARY");
            if (i == 1) assertThat(rev.questions()).extracting(LearnService.QuestionView::id).containsExactly("v1.01:meaning");
            LearnService.Outcome o = learn.submitRevision(me, List.of(new AnswerIn("v1.01:meaning", "borrow")));
            assertThat(o.percent()).isEqualTo(100);
            // The next review is scheduled in the future, so the word is no longer due straight away.
            if (i < 3) assertThat(learn.overview(me).dueCount()).isZero();
            makeDue(me, "v1.01");
        }
        assertThat(learn.word(me, "v1.01").status()).isEqualTo("LEARNED");
        assertThat(learn.progress(me).wordsLearned()).isEqualTo(1);
        assertThat(learn.vocabularyLevel(me, 1).level().completed()).isEqualTo(1);
    }

    @Autowired jakarta.persistence.EntityManager em;

    private void makeDue(UUID user, String itemId) {
        em.flush();
        em.createNativeQuery("update item_progress set next_review_at = now() - interval '1 minute' where user_id = :u and item_id = :i")
                .setParameter("u", user).setParameter("i", itemId).executeUpdate();
        em.clear();
    }

    @Test
    void wrongAnswersMakeAWordDifficultAndBringItBack() {
        UUID me = person();
        learn.setSaved(me, "v1.02", true);
        for (int i = 0; i < 2; i++) learn.submitRevision(me, List.of(new AnswerIn("v1.02:cloze", "wrong")));
        assertThat(learn.collection(me, "VOCABULARY", "difficult")).extracting(LearnService.ItemRow::label).containsExactly("buy");
        assertThat(learn.word(me, "v1.02").difficult()).isTrue();
        assertThat(learn.word(me, "v1.02").status()).isEqualTo("LEARNING");
        learn.setSaved(me, "v1.02", false);
        assertThat(learn.collection(me, "VOCABULARY", "saved")).isEmpty();
    }

    @Test
    void unsavingAnUntouchedWordLeavesNoTraceAndUnknownItemsAreRefused() {
        UUID me = person();
        learn.setSaved(me, "v1.03", true);
        learn.setSaved(me, "v1.03", false);
        assertThat(learn.collection(me, null, "saved")).isEmpty();
        assertThat(learn.overview(me).dueCount()).isZero();
        assertThatThrownBy(() -> learn.setSaved(me, "v9.99", true)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("ITEM_NOT_FOUND"));
        assertThatThrownBy(() -> learn.submitRevision(me, List.of(new AnswerIn("g1.01.a1", "x")))).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("WRONG_QUESTIONS"));
    }

    @Test
    void phrasalVerbLessonsTrackTheVerbAsWell() {
        UUID me = person();
        LearnService.Outcome o = learn.submitLesson(me, "p1.09", assessmentAnswers("p1.09", true));
        assertThat(o.lessonCompleted()).isTrue();
        assertThat(learn.phrasalLevel(me, 1).level().completed()).as("a phrasal verb counts as learned after three correct reviews, like a word").isZero();
        assertThat(learn.collection(me, "PHRASAL", "saved")).isEmpty();
        learn.setSaved(me, "p1.09", true);
        assertThat(learn.collection(me, "PHRASAL", "saved")).extracting(LearnService.ItemRow::label).containsExactly("pick up");
        LearnService.PhrasalLessonView view = (LearnService.PhrasalLessonView) learn.lesson(me, "p1.09");
        assertThat(view.saved()).isTrue();
        assertThat(view.status()).isEqualTo("COMPLETED");
    }

    // ---------------------------------------------------------------- the daily lesson

    private List<AnswerIn> practiceAnswers(LearnService.Quiz quiz, boolean right) {
        List<AnswerIn> out = new ArrayList<>();
        for (LearnService.QuestionView q : quiz.questions()) {
            if (q.type().equals("match")) {
                List<String> pairs = new ArrayList<>();
                for (String left : q.left()) {
                    String meaning = curriculum.allWords().stream().filter(w -> w.word().equals(left)).map(Curriculum.Word::meaning).findFirst()
                            .orElseGet(() -> curriculum.allPhrasal().stream().filter(l -> l.verb().equals(left)).map(Curriculum.PhrasalLesson::meaning).findFirst().orElseThrow());
                    pairs.add(left + "=>" + (right ? meaning : "nothing"));
                }
                out.add(new AnswerIn(q.id(), String.join("||", pairs)));
            } else {
                out.add(new AnswerIn(q.id(), right ? curriculum.question(q.id()).orElseThrow().correctAnswer() : "definitely wrong"));
            }
        }
        return out;
    }

    private void moveBackOneDay(UUID user) {
        em.flush();
        em.createNativeQuery("update daily_plans set plan_date = plan_date - 1 where user_id = :u").setParameter("u", user).executeUpdate();
        em.createNativeQuery("update learning_days set day = day - 1 where user_id = :u").setParameter("u", user).executeUpdate();
        em.clear();
    }

    private void finishToday(UUID me, LearnService.DailyPlanView plan) {
        learn.submitLesson(me, plan.grammar().lessonId(), assessmentAnswers(plan.grammar().lessonId(), true));
        learn.submitDailyPractice(me, "vocabulary", practiceAnswers(learn.dailyPractice(me, "vocabulary"), true));
        learn.submitDailyPractice(me, "phrasal", practiceAnswers(learn.dailyPractice(me, "phrasal"), true));
        learn.speakingDone(me);
    }

    @Test
    void theFirstDailyLessonFollowsTheFixedSequenceFromTheBeginning() {
        UUID me = person();
        LearnService.DailyPlanView plan = learn.today(me);
        assertThat(plan.day()).isEqualTo(1);
        assertThat(plan.grammar().lessonId()).isEqualTo("g1.01");
        assertThat(plan.words().items()).hasSize(LearnService.DAILY_WORDS);
        assertThat(plan.words().items().stream().map(LearnService.PlanItem::id).toList()).startsWith("v1.01", "v1.02", "v1.03");
        assertThat(plan.phrasal().items()).hasSize(LearnService.DAILY_PHRASAL);
        assertThat(plan.phrasal().items().stream().map(LearnService.PlanItem::id).toList()).containsExactly("p1.01", "p1.02", "p1.03", "p1.04", "p1.05");
        assertThat(plan.words().items()).allSatisfy(i -> { assertThat(i.kn()).isNotBlank(); assertThat(i.status()).isEqualTo("NEW"); });
        assertThat(plan.speaking().prompt()).contains("Speak aloud").contains(plan.words().items().get(0).label()).contains(plan.phrasal().items().get(0).label());
        assertThat(plan.partsTotal()).as("grammar, words, phrasal verbs and speaking: nothing to revise yet").isEqualTo(4);
        assertThat(plan.partsDone()).isZero();
        assertThat(plan.revision().needed()).isFalse();
        assertThat(plan.complete()).isFalse();
        assertThat(plan.canLearnMore()).isFalse();
        assertThat(learn.today(me)).as("the same lesson all day, not random").isEqualTo(plan);
        assertThat(learn.overview(me).today().partsDone()).isZero();
    }

    @Test
    void theDailyPracticeGradesEveryAnswerAndFeedsTheReviewSchedule() {
        UUID me = person();
        LearnService.DailyPlanView plan = learn.today(me);
        LearnService.Quiz quiz = learn.dailyPractice(me, "vocabulary");
        assertThat(quiz.kind()).isEqualTo("DAILY");
        assertThat(quiz.questions()).hasSize(LearnService.DAILY_WORDS + 1); // ten questions and a matching exercise
        assertThat(quiz.questions().get(0).type()).isEqualTo("match");
        assertThat(quiz.questions().get(0).left()).hasSize(5);
        assertThat(quiz.questions().get(0).right()).containsExactlyInAnyOrderElementsOf(
                plan.words().items().subList(0, 5).stream().map(LearnService.PlanItem::meaning).toList());

        LearnService.Outcome wrong = learn.submitDailyPractice(me, "vocabulary", practiceAnswers(quiz, false));
        assertThat(wrong.percent()).isZero();
        assertThat(wrong.results()).allSatisfy(r -> assertThat(r.correctAnswer()).isNotBlank());
        assertThat(learn.today(me).words().done()).as("taking the practice completes the part, whatever the score").isTrue();
        assertThat(learn.word(me, "v1.01").status()).as("a wrong answer never makes a word look learned").isNotEqualTo("LEARNED");
        assertThat(learn.progress(me).recent().get(0).kind()).isEqualTo("DAILY");
        assertThat(learn.progress(me).recent().get(0).label()).isEqualTo("Daily vocabulary practice");

        LearnService.Outcome right = learn.submitDailyPractice(me, "vocabulary", practiceAnswers(learn.dailyPractice(me, "vocabulary"), true));
        assertThat(right.percent()).isEqualTo(100);
        assertThat(learn.word(me, "v1.01").status()).isEqualTo("LEARNING");
        assertThat(learn.progress(me).learningStreakDays()).isEqualTo(1);
    }

    @Test
    void theDailyPracticeRefusesQuestionsThatAreNotTodaysAndPartsThatDoNotExist() {
        UUID me = person();
        learn.today(me);
        assertThatThrownBy(() -> learn.submitDailyPractice(me, "vocabulary", List.of(new AnswerIn("v5.90:meaning", "idiosyncratic"))))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("WRONG_QUESTIONS"));
        assertThatThrownBy(() -> learn.submitDailyPractice(me, "phrasal", List.of(new AnswerIn("v1.01:meaning", "borrow"))))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("WRONG_QUESTIONS"));
        assertThatThrownBy(() -> learn.dailyPractice(me, "grammar")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("PART_NOT_FOUND"));
        assertThatThrownBy(() -> learn.submitDailyPractice(me, "vocabulary", List.of())).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("NO_ANSWERS"));
        // Another learner has no lesson yet.
        assertThatThrownBy(() -> learn.dailyPractice(person(), "vocabulary")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("NO_PLAN"));
    }

    @Test
    void aFinishedLessonCanBeFollowedByMoreAndNeverRepeatsCompletedContent() {
        UUID me = person();
        LearnService.DailyPlanView first = learn.today(me);
        assertThatThrownBy(() -> learn.learnMore(me)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("FINISH_FIRST"));
        finishToday(me, first);
        LearnService.DailyPlanView done = learn.today(me);
        assertThat(done.complete()).isTrue();
        assertThat(done.partsDone()).isEqualTo(done.partsTotal());
        assertThat(done.canLearnMore()).isTrue();
        assertThat(done.day()).isEqualTo(1);

        LearnService.DailyPlanView second = learn.learnMore(me);
        assertThat(second.day()).isEqualTo(2);
        assertThat(second.grammar().lessonId()).isEqualTo("g1.02");
        assertThat(second.words().items().stream().map(LearnService.PlanItem::id).toList()).doesNotContainAnyElementsOf(first.words().items().stream().map(LearnService.PlanItem::id).toList());
        assertThat(second.words().items().get(0).id()).isEqualTo("v1.11");
        assertThat(second.phrasal().items().get(0).id()).isEqualTo("p1.06");
        assertThat(learn.today(me).day()).as("the new lesson is now the current one").isEqualTo(2);
        assertThat(second.remaining().words()).isEqualTo(learn.today(me).remaining().words());

        finishToday(me, second);
        LearnService.DailyPlanView third = learn.learnMore(me);
        assertThat(third.day()).isEqualTo(3);
        finishToday(me, third);
        assertThatThrownBy(() -> learn.learnMore(me)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("ENOUGH_FOR_TODAY"));
        assertThat(learn.today(me).canLearnMore()).isFalse();
        assertThat(learn.progress(me).daysCompleted()).isEqualTo(3);
    }

    @Test
    void anUnfinishedLessonWaitsForTheLearnerAndAFinishedOneIsReplacedTomorrow() {
        UUID me = person();
        LearnService.DailyPlanView first = learn.today(me);
        learn.submitDailyPractice(me, "vocabulary", practiceAnswers(learn.dailyPractice(me, "vocabulary"), true));
        moveBackOneDay(me); // the next day: the lesson was not finished
        LearnService.DailyPlanView again = learn.today(me);
        assertThat(again.day()).as("carry on where you stopped").isEqualTo(1);
        assertThat(again.grammar().lessonId()).isEqualTo(first.grammar().lessonId());
        assertThat(again.words().done()).isTrue();
        assertThat(again.words().items()).isEqualTo(learn.today(me).words().items());

        finishToday(me, again);
        assertThat(learn.progress(me).daysCompleted()).as("the finishing moment is recorded").isEqualTo(1);
        moveBackOneDay(me); // the day after: finished yesterday, so today brings a new lesson
        LearnService.DailyPlanView next = learn.today(me);
        assertThat(next.day()).isEqualTo(2);
        assertThat(next.complete()).isFalse();
        assertThat(next.grammar().lessonId()).isEqualTo("g1.02");
        assertThat(next.words().items().get(0).id()).isEqualTo("v1.11");
    }

    @Test
    void revisionBecomesPartOfTheLessonOnceItemsAreDue() {
        UUID me = person();
        LearnService.DailyPlanView first = learn.today(me);
        assertThat(first.revision().dueCount()).isZero();
        assertThat(first.revision().needed()).as("nothing to revise yet").isFalse();
        finishToday(me, first);
        for (LearnService.PlanItem i : first.words().items()) makeDue(me, i.id());
        LearnService.DailyPlanView second = learn.learnMore(me);
        assertThat(second.revision().dueCount()).isEqualTo(LearnService.DAILY_WORDS);
        assertThat(second.revision().needed()).isTrue();
        assertThat(second.revision().done()).isFalse();
        learn.submitLesson(me, second.grammar().lessonId(), assessmentAnswers(second.grammar().lessonId(), true));
        learn.submitDailyPractice(me, "vocabulary", practiceAnswers(learn.dailyPractice(me, "vocabulary"), true));
        learn.submitDailyPractice(me, "phrasal", practiceAnswers(learn.dailyPractice(me, "phrasal"), true));
        learn.speakingDone(me);
        assertThat(learn.today(me).complete()).as("the lesson is not finished until the due items are revised").isFalse();
        LearnService.Quiz revision = learn.revision(me, null);
        assertThat(revision.questions()).isNotEmpty();
        learn.submitRevision(me, revision.questions().stream().map(q -> new AnswerIn(q.id(), curriculum.question(q.id()).orElseThrow().correctAnswer())).toList());
        assertThat(learn.today(me).revision().done()).isTrue();
        assertThat(learn.today(me).complete()).isTrue();
        assertThat(learn.progress(me).dueTomorrow()).isGreaterThanOrEqualTo(0);
    }

    @Test
    void wordsAreBrowsableByGroupAndEveryGroupAddsUpToTheWholeCourse() {
        UUID me = person();
        var groups = learn.themes(me, Curriculum.Subject.VOCABULARY);
        assertThat(groups).hasSize(Curriculum.WORD_THEMES.size());
        assertThat(groups.stream().mapToInt(LearnService.ThemeSummary::total).sum()).isEqualTo(curriculum.allWords().size());
        var first = learn.vocabularyTheme(me, groups.get(0).id());
        assertThat(first.words()).hasSize(groups.get(0).total());
        assertThat(first.words()).allSatisfy(w -> assertThat(w.theme()).isEqualTo(groups.get(0).id()));
        var verbs = learn.themes(me, Curriculum.Subject.PHRASAL);
        assertThat(verbs.stream().mapToInt(LearnService.ThemeSummary::total).sum()).isEqualTo(curriculum.allPhrasal().size());
        assertThat(learn.phrasalTheme(me, verbs.get(0).id()).verbs()).allSatisfy(v -> assertThat(v.kn()).isNotBlank());
        assertThatThrownBy(() -> learn.vocabularyTheme(me, "nonsense")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("THEME_NOT_FOUND"));
    }

    @Test
    void newExerciseTypesAreSentWithoutTheirAnswersAndCheckedOnTheWholeSentence() {
        UUID me = person();
        LearnService.GrammarLessonView lesson = (LearnService.GrammarLessonView) learn.lesson(me, "g1.01");
        assertThat(lesson.definition()).isNotBlank();
        assertThat(lesson.details()).hasSizeGreaterThanOrEqualTo(2);
        LearnService.QuestionView reorder = lesson.exercises().stream().filter(q -> q.type().equals("reorder")).findFirst().orElseThrow();
        assertThat(reorder.words()).hasSizeGreaterThanOrEqualTo(3);
        assertThat(reorder.toString()).doesNotContain("answers");
        assertThat(learn.check(reorder.id(), "Maria reads books every day.").correct()).isTrue();
        assertThat(learn.check(reorder.id(), "day every books reads Maria").correct()).isFalse();
        LearnService.QuestionView correct = lesson.exercises().stream().filter(q -> q.type().equals("correct")).findFirst().orElseThrow();
        assertThat(learn.check(correct.id(), "She drinks tea.").correct()).isTrue();
    }

    @Test
    void learningDaysAndStreakCountOnlyRealPractice() {
        LocalDate today = LocalDate.of(2026, 11, 10);
        assertThat(LearnService.streak(List.of(), today)).isZero();
        assertThat(LearnService.streak(List.of(today, today.minusDays(1), today.minusDays(2)), today)).isEqualTo(3);
        assertThat(LearnService.streak(List.of(today.minusDays(1), today.minusDays(2)), today)).as("still alive until the day ends").isEqualTo(2);
        assertThat(LearnService.streak(List.of(today.minusDays(2)), today)).isZero();
        assertThat(LearnService.streak(List.of(today, today.minusDays(2)), today)).isEqualTo(1);
    }
}
