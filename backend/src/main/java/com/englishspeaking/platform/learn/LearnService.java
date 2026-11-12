package com.englishspeaking.platform.learn;

import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.learn.Curriculum.GrammarLesson;
import com.englishspeaking.platform.learn.Curriculum.Mistake;
import com.englishspeaking.platform.learn.Curriculum.PhrasalLesson;
import com.englishspeaking.platform.learn.Curriculum.Question;
import com.englishspeaking.platform.learn.Curriculum.Subject;
import com.englishspeaking.platform.learn.Curriculum.Word;
import com.englishspeaking.platform.profile.EnglishLevel;
import com.englishspeaking.platform.profile.UserProfileRepository;
import com.fasterxml.jackson.annotation.JsonInclude;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Lessons, tests, the daily lesson, vocabulary review and learning progress.
 *
 * <p>Everything recorded here comes from answers that were graded on the server. Nothing is estimated and nothing is invented:
 * a lesson is completed only when its assessment was passed, a word counts as learned only after three correct reviews, and the
 * streak counts only days on which a test or review was really taken. This is learning progress, which is kept; it is separate from
 * the AI Coach, whose conversations are never stored.
 */
@Service
public class LearnService {
    public static final int PASS_PERCENT = 70;
    public static final int QUIZ_SIZE = 10;
    static final int MIN_LEVEL_TEST_ANSWERS = 5;
    static final int MAX_ANSWERS = 15;
    /** The daily lesson: one grammar lesson, this many new words and this many new phrasal verbs. */
    public static final int DAILY_WORDS = 10;
    public static final int DAILY_PHRASAL = 5;
    /** A learner who finishes early can ask for more, a few times a day. */
    public static final int MAX_PLANS_PER_DAY = 3;
    static final int MATCH_SIZE = 5;

    // ---------------------------------------------------------------- what the app receives

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record QuestionView(String id, String type, String prompt, List<String> options, List<String> words, List<String> left, List<String> right) {}

    public record LevelSummary(int level, String title, String summary, int total, int completed, Integer testPercent) {}

    public record SubjectSummary(String id, String title, String description, String unit, int total, int completed, List<LevelSummary> levels) {}

    public record NextStep(String lessonId, String title, String subject, int level) {}

    public record TodaySummary(int day, boolean complete, int partsDone, int partsTotal) {}

    public record Overview(List<SubjectSummary> subjects, NextStep next, long dueCount, TodaySummary today) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LessonRow(String id, String title, String status, int bestPercent, int attempts, String meaning, String kn, String theme, String register, String separable) {}

    public record LevelView(String subject, LevelSummary level, List<LessonRow> lessons) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record WordRow(String id, String word, String pos, String meaning, String kn, int level, String theme, String status, boolean saved, boolean difficult) {}

    public record VocabularyLevelView(LevelSummary level, List<WordRow> words) {}

    public record ThemeSummary(String id, String title, int total, int learned) {}

    public record ThemeWords(ThemeSummary theme, List<WordRow> words) {}

    public record ThemeVerbs(ThemeSummary theme, List<LessonRow> verbs) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record WordView(String id, int level, String word, String pos, String meaning, String kn, String example, String collocation, String theme, String note,
                           List<String> conversation, List<String> synonyms, List<String> antonyms, String build, String status, boolean saved, boolean difficult) {}

    public record GrammarLessonView(String subject, String id, int level, String levelTitle, String title, String definition, String explain, List<String> details,
                                    List<String> structures, List<String> positive, List<String> negative, List<String> questions, List<String> reallife,
                                    List<Mistake> mistakes, List<QuestionView> exercises, List<QuestionView> assessment, String status,
                                    int bestPercent, int attempts, String nextLessonId) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PhrasalLessonView(String subject, String id, int level, String levelTitle, String verb, String meaning, String kn, String note, String separable,
                                    String usage, String theme, String register, List<Curriculum.Sense> senses, List<String> examples, List<String> reallife,
                                    List<Mistake> mistakes, Curriculum.Conversation conversation, List<QuestionView> assessment, String status, int bestPercent,
                                    int attempts, boolean saved, String nextLessonId) {}

    public record ItemRow(String id, String subject, String label, String meaning, String status, boolean saved, boolean difficult, Instant nextReviewAt) {}

    public record Quiz(String kind, String subject, int level, List<QuestionView> questions) {}

    public record AnswerIn(String id, String answer) {}

    public record QuestionResult(String id, boolean correct, String yourAnswer, String correctAnswer, String why) {}

    public record Outcome(int correct, int total, int percent, boolean passed, boolean lessonCompleted, List<QuestionResult> results) {}

    public record CheckResult(boolean correct, String correctAnswer, String why) {}

    public record RecentResult(String kind, String subject, String label, int percent, int correct, int total, Instant takenAt) {}

    public record WeakTopic(String lessonId, String title, int level, int accuracyPercent) {}

    public record Progress(int grammarCompleted, int grammarTotal, int phrasalCompleted, int phrasalTotal, int wordsLearned, int wordsSaved,
                           int wordsTotal, int phrasalVerbsLearned, int phrasalVerbsTotal, Integer averagePercent, List<RecentResult> recent,
                           int learningStreakDays, int practiceDaysLast30, List<WeakTopic> weakTopics, long dueCount, long dueTomorrow, long dueThisWeek,
                           int daysCompleted, NextStep next, TodaySummary today) {}

    // ---- the daily lesson

    public record PlanItem(String id, String label, String meaning, String kn, String status) {}

    public record PlanPart(List<PlanItem> items, boolean done) {}

    public record GrammarPart(String lessonId, String title, int level, String status, int bestPercent, int attempts, boolean done) {}

    public record RevisionPart(long dueCount, boolean done, boolean needed) {}

    public record SpeakingPart(String prompt, String coachMode, boolean done) {}

    public record Remaining(int grammarLessons, int words, int phrasalVerbs) {}

    public record DailyPlanView(int day, LocalDate date, boolean complete, int partsDone, int partsTotal, GrammarPart grammar, PlanPart words, PlanPart phrasal,
                                RevisionPart revision, SpeakingPart speaking, int streakDays, boolean canLearnMore, Remaining remaining) {}

    // ---------------------------------------------------------------- wiring

    private final Curriculum curriculum;
    private final LearningStore store;
    private final UserProfileRepository profiles;
    private final Clock clock;
    private final Random random;

    @Autowired
    public LearnService(Curriculum curriculum, LearningStore store, UserProfileRepository profiles, Clock clock) {
        this(curriculum, store, profiles, clock, new Random());
    }

    LearnService(Curriculum curriculum, LearningStore store, UserProfileRepository profiles, Clock clock, Random random) {
        this.curriculum = curriculum;
        this.store = store;
        this.profiles = profiles;
        this.clock = clock;
        this.random = random;
    }

    // ---------------------------------------------------------------- overview and levels

    @Transactional(readOnly = true)
    public Overview overview(UUID user) {
        Map<String, LessonProgress> lessons = store.lessonProgress(user);
        Map<String, ItemProgress> items = store.items(user);
        Map<String, Integer> tests = bestLevelTests(user);
        List<SubjectSummary> subjects = List.of(
                subject(Subject.GRAMMAR, "grammar", "Grammar", "Structured lessons from the basics to advanced structures.", "lessons completed", lessons, items, tests),
                subject(Subject.VOCABULARY, "vocabulary", "Vocabulary", "Words with meanings, examples and spaced revision.", "words learned", lessons, items, tests),
                subject(Subject.PHRASAL, "phrasal", "Phrasal verbs", "Common phrasal verbs with their meanings, examples and practice.", "phrasal verbs learned", lessons, items, tests));
        return new Overview(subjects, nextStep(lessons), store.dueCount(user, clock.instant()), todaySummary(user, lessons, items));
    }

    @Transactional(readOnly = true)
    public LevelView grammarLevel(UUID user, int level) {
        Curriculum.LevelInfo info = curriculum.level(Subject.GRAMMAR, level).orElseThrow(() -> ApiException.notFound("LEVEL_NOT_FOUND", "That level does not exist."));
        Map<String, LessonProgress> lessons = store.lessonProgress(user);
        List<LessonRow> rows = curriculum.grammarLessons(level).stream().map(l -> row(l.id(), l.title(), lessons.get(l.id()))).toList();
        return new LevelView("grammar", levelSummary(Subject.GRAMMAR, info, lessons, Map.of(), bestLevelTests(user)), rows);
    }

    @Transactional(readOnly = true)
    public LevelView phrasalLevel(UUID user, int level) {
        Curriculum.LevelInfo info = curriculum.level(Subject.PHRASAL, level).orElseThrow(() -> ApiException.notFound("LEVEL_NOT_FOUND", "That level does not exist."));
        Map<String, ItemProgress> items = store.items(user);
        List<LessonRow> rows = curriculum.phrasalLessons(level).stream().map(l -> phrasalRow(l, items.get(l.id()))).toList();
        return new LevelView("phrasal", levelSummary(Subject.PHRASAL, info, Map.of(), items, bestLevelTests(user)), rows);
    }

    @Transactional(readOnly = true)
    public VocabularyLevelView vocabularyLevel(UUID user, int level) {
        Curriculum.LevelInfo info = curriculum.level(Subject.VOCABULARY, level).orElseThrow(() -> ApiException.notFound("LEVEL_NOT_FOUND", "That level does not exist."));
        Map<String, ItemProgress> items = store.items(user);
        List<WordRow> rows = curriculum.wordsOf(level).stream().map(w -> wordRow(w, items.get(w.id()))).toList();
        return new VocabularyLevelView(levelSummary(Subject.VOCABULARY, info, Map.of(), items, bestLevelTests(user)), rows);
    }

    @Transactional(readOnly = true)
    public List<ThemeSummary> themes(UUID user, Subject subject) {
        Map<String, ItemProgress> items = store.items(user);
        List<ThemeSummary> out = new ArrayList<>();
        if (subject == Subject.VOCABULARY) {
            Curriculum.WORD_THEMES.forEach((id, title) -> out.add(themeSummary(id, title, curriculum.wordsOfTheme(id).stream().map(Word::id).toList(), items)));
        } else {
            Curriculum.PHRASAL_THEMES.forEach((id, title) -> out.add(themeSummary(id, title, curriculum.phrasalOfTheme(id).stream().map(PhrasalLesson::id).toList(), items)));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public ThemeWords vocabularyTheme(UUID user, String theme) {
        String title = Curriculum.WORD_THEMES.get(theme);
        if (title == null) throw ApiException.notFound("THEME_NOT_FOUND", "That group does not exist.");
        Map<String, ItemProgress> items = store.items(user);
        List<Word> words = curriculum.wordsOfTheme(theme);
        return new ThemeWords(themeSummary(theme, title, words.stream().map(Word::id).toList(), items), words.stream().map(w -> wordRow(w, items.get(w.id()))).toList());
    }

    @Transactional(readOnly = true)
    public ThemeVerbs phrasalTheme(UUID user, String theme) {
        String title = Curriculum.PHRASAL_THEMES.get(theme);
        if (title == null) throw ApiException.notFound("THEME_NOT_FOUND", "That group does not exist.");
        Map<String, ItemProgress> items = store.items(user);
        List<PhrasalLesson> verbs = curriculum.phrasalOfTheme(theme);
        return new ThemeVerbs(themeSummary(theme, title, verbs.stream().map(PhrasalLesson::id).toList(), items), verbs.stream().map(l -> phrasalRow(l, items.get(l.id()))).toList());
    }

    @Transactional(readOnly = true)
    public WordView word(UUID user, String id) {
        Word w = curriculum.word(id).orElseThrow(() -> ApiException.notFound("WORD_NOT_FOUND", "That word does not exist."));
        ItemProgress p = store.item(user, id).orElse(null);
        return new WordView(w.id(), w.level(), w.word(), w.pos(), w.meaning(), w.kn(), w.example(), w.collocation(), w.theme(), w.note(), w.conversation(), w.synonyms(),
                w.antonyms(), w.build(), status(p), p != null && p.isSaved(), p != null && p.isDifficult());
    }

    /** One lesson (grammar or phrasal verb). Assessment questions are sent without their answers. */
    @Transactional(readOnly = true)
    public Object lesson(UUID user, String id) {
        Optional<GrammarLesson> g = curriculum.grammarLesson(id);
        if (g.isPresent()) {
            GrammarLesson l = g.get();
            LessonProgress p = store.lessonProgress(user).get(id);
            return new GrammarLessonView("grammar", l.id(), l.level(), curriculum.level(Subject.GRAMMAR, l.level()).orElseThrow().title(), l.title(), l.definition(), l.explain(),
                    l.details(), l.structures(), l.positive(), l.negative(), l.questions(), l.reallife(), l.mistakes(), views(l.exercises()), views(l.assessment()),
                    lessonStatus(p), p == null ? 0 : p.getBestPercent(), p == null ? 0 : p.getAttempts(), nextGrammar(l));
        }
        PhrasalLesson l = curriculum.phrasalLesson(id).orElseThrow(() -> ApiException.notFound("LESSON_NOT_FOUND", "That lesson does not exist."));
        LessonProgress p = store.lessonProgress(user).get(id);
        ItemProgress item = store.item(user, id).orElse(null);
        return new PhrasalLessonView("phrasal", l.id(), l.level(), curriculum.level(Subject.PHRASAL, l.level()).orElseThrow().title(), l.verb(), l.meaning(), l.kn(), l.note(),
                l.separable(), l.usage(), l.theme(), l.register(), l.senses(), l.examples(), l.reallife(), l.mistakes(), l.conversation(), views(l.assessment()), lessonStatus(p),
                p == null ? 0 : p.getBestPercent(), p == null ? 0 : p.getAttempts(), item != null && item.isSaved(), nextPhrasal(l));
    }

    // ---------------------------------------------------------------- practice and tests

    /** Practice exercises give instant feedback and record nothing. Assessment answers are never revealed this way. */
    public CheckResult check(String questionId, String answer) {
        Question q = curriculum.question(questionId).orElseThrow(() -> ApiException.notFound("QUESTION_NOT_FOUND", "That question does not exist."));
        if (!questionId.matches("g\\d\\.\\d\\d\\.e\\d+")) throw ApiException.badRequest("NOT_AN_EXERCISE", "Only practice exercises can be checked one at a time.");
        return new CheckResult(q.accepts(answer), q.correctAnswer(), q.why());
    }

    /** Grades a lesson's short assessment. Passing it completes the lesson. */
    @Transactional
    public Outcome submitLesson(UUID user, String lessonId, List<AnswerIn> answers) {
        Optional<GrammarLesson> g = curriculum.grammarLesson(lessonId);
        Optional<PhrasalLesson> p = curriculum.phrasalLesson(lessonId);
        if (g.isEmpty() && p.isEmpty()) throw ApiException.notFound("LESSON_NOT_FOUND", "That lesson does not exist.");
        List<Question> expected = g.map(GrammarLesson::assessment).orElseGet(() -> p.orElseThrow().assessment());
        Map<String, String> given = answerMap(answers);
        Set<String> expectedIds = expected.stream().map(Question::id).collect(Collectors.toSet());
        if (!expectedIds.containsAll(given.keySet())) throw ApiException.badRequest("WRONG_QUESTIONS", "Those answers do not belong to this lesson.");

        Instant now = clock.instant();
        List<QuestionResult> results = new ArrayList<>();
        int correct = 0;
        for (Question q : expected) {
            String a = given.getOrDefault(q.id(), "");
            boolean ok = q.accepts(a);
            if (ok) correct++;
            results.add(new QuestionResult(q.id(), ok, a, q.correctAnswer(), q.why()));
        }
        int percent = percent(correct, expected.size());
        boolean passed = percent >= PASS_PERCENT;

        LessonProgress progress = store.lessonProgressForUpdate(user, lessonId, now);
        boolean wasCompleted = progress.isCompleted();
        progress.record(percent, passed, now);
        store.addResult(user, "LESSON", g.isPresent() ? "GRAMMAR" : "PHRASAL", lessonId, correct, expected.size(), now);
        if (g.isPresent()) {
            TopicStat t = store.topicStatForUpdate(user, lessonId, now);
            t.add(correct, expected.size() - correct, now);
        } else {
            store.itemForUpdate(user, lessonId, "PHRASAL", now).review(passed, now);
        }
        store.touchDay(user, today(now));
        markIfComplete(user, now);
        return new Outcome(correct, expected.size(), percent, passed, passed && !wasCompleted, results);
    }

    /** A fresh level test of {@link #QUIZ_SIZE} questions, drawn from that level's real questions. */
    @Transactional(readOnly = true)
    public Quiz levelTest(Subject subject, int level) {
        if (curriculum.level(subject, level).isEmpty()) throw ApiException.notFound("LEVEL_NOT_FOUND", "That level does not exist.");
        List<QuestionView> out = new ArrayList<>();
        switch (subject) {
            case GRAMMAR -> {
                List<GrammarLesson> lessons = new ArrayList<>(curriculum.grammarLessons(level));
                Collections.shuffle(lessons, random);
                for (GrammarLesson l : lessons.subList(0, Math.min(QUIZ_SIZE, lessons.size()))) {
                    // Only assessment questions: practice exercises can be checked one by one, so their answers are not secret.
                    out.add(view(l.assessment().get(random.nextInt(l.assessment().size()))));
                }
            }
            case VOCABULARY -> {
                List<Word> words = new ArrayList<>(curriculum.wordsOf(level));
                Collections.shuffle(words, random);
                for (Word w : words.subList(0, Math.min(QUIZ_SIZE, words.size()))) out.add(itemQuestion(w.id(), random.nextBoolean() ? "cloze" : "meaning", Subject.VOCABULARY, level));
            }
            case PHRASAL -> {
                List<PhrasalLesson> lessons = new ArrayList<>(curriculum.phrasalLessons(level));
                Collections.shuffle(lessons, random);
                for (PhrasalLesson l : lessons.subList(0, Math.min(QUIZ_SIZE, lessons.size()))) out.add(itemQuestion(l.id(), random.nextBoolean() ? "cloze" : "meaning", Subject.PHRASAL, level));
            }
        }
        return new Quiz("LEVEL", subject.name().toLowerCase(), level, out);
    }

    /** Grades a level test. Only a test with enough answers is recorded, so a single lucky answer cannot count as a result. */
    @Transactional
    public Outcome submitLevelTest(UUID user, Subject subject, int level, List<AnswerIn> answers) {
        if (curriculum.level(subject, level).isEmpty()) throw ApiException.notFound("LEVEL_NOT_FOUND", "That level does not exist.");
        String prefix = switch (subject) { case GRAMMAR -> "g"; case VOCABULARY -> "v"; case PHRASAL -> "p"; } + level + ".";
        Map<String, String> given = answerMap(answers);
        if (given.size() < MIN_LEVEL_TEST_ANSWERS) throw ApiException.badRequest("TOO_FEW_ANSWERS", "Answer at least " + MIN_LEVEL_TEST_ANSWERS + " questions.");
        for (String id : given.keySet()) {
            if (!id.startsWith(prefix)) throw ApiException.badRequest("WRONG_QUESTIONS", "Those answers do not belong to this level.");
        }
        Instant now = clock.instant();
        Outcome outcome = gradeAndRecord(user, given, now);
        store.addResult(user, "LEVEL", subject.name(), subject.name().toLowerCase() + ":" + level, outcome.correct(), outcome.total(), now);
        store.touchDay(user, today(now));
        return outcome;
    }

    // ---------------------------------------------------------------- words and spaced revision

    /** Saves or unsaves a word or phrasal verb. A saved item joins the review queue at once. */
    @Transactional
    public ItemRow setSaved(UUID user, String itemId, boolean saved) {
        Subject subject = curriculum.itemSubject(itemId).orElseThrow(() -> ApiException.notFound("ITEM_NOT_FOUND", "That item does not exist."));
        Instant now = clock.instant();
        ItemProgress p = store.itemForUpdate(user, itemId, kind(subject), now);
        p.save(saved, now);
        if (p.isUnused()) store.delete(p);
        return itemRow(itemId, p.isUnused() ? null : p);
    }

    @Transactional(readOnly = true)
    public List<ItemRow> collection(UUID user, String kind, String type) {
        Map<String, ItemProgress> items = store.items(user);
        List<ItemRow> rows = new ArrayList<>();
        for (ItemProgress p : items.values()) {
            if (kind != null && !kind.equalsIgnoreCase(p.getKind())) continue;
            boolean match = switch (type) { case "saved" -> p.isSaved(); case "difficult" -> p.isDifficult(); default -> false; };
            if (match && curriculum.itemSubject(p.itemId()).isPresent()) rows.add(itemRow(p.itemId(), p));
        }
        rows.sort(java.util.Comparator.comparing(ItemRow::label));
        return rows;
    }

    /** Up to ten saved or previously tested items that are due for review now. */
    @Transactional(readOnly = true)
    public Quiz revision(UUID user, String kind) {
        List<ItemProgress> due = store.due(user, kind, clock.instant(), QUIZ_SIZE);
        List<QuestionView> out = new ArrayList<>();
        for (ItemProgress p : due) {
            Subject s = curriculum.itemSubject(p.itemId()).orElse(null);
            if (s == null) continue;
            int level = s == Subject.VOCABULARY ? curriculum.word(p.itemId()).orElseThrow().level() : curriculum.phrasalLesson(p.itemId()).orElseThrow().level();
            // Newer items are asked as recognition (which one means...), more secure items as recall (fill in the blank).
            out.add(itemQuestion(p.itemId(), p.getBox() <= 1 ? "meaning" : "cloze", s, level));
        }
        return new Quiz("REVISION", kind == null ? "all" : kind.toLowerCase(), 0, out);
    }

    @Transactional
    public Outcome submitRevision(UUID user, List<AnswerIn> answers) {
        Map<String, String> given = answerMap(answers);
        if (given.isEmpty()) throw ApiException.badRequest("NO_ANSWERS", "There is nothing to submit.");
        for (String id : given.keySet()) {
            if (id.indexOf(':') < 0) throw ApiException.badRequest("WRONG_QUESTIONS", "Only review questions can be submitted here.");
        }
        Instant now = clock.instant();
        Outcome outcome = gradeAndRecord(user, given, now);
        boolean allPhrasal = given.keySet().stream().allMatch(id -> id.startsWith("p"));
        store.addResult(user, "REVISION", allPhrasal ? "PHRASAL" : "VOCABULARY", "revision", outcome.correct(), outcome.total(), now);
        store.touchDay(user, today(now));
        store.latestPlan(user).ifPresent(DailyPlan::revisionDone); // today's revision part is done once a revision was really taken
        markIfComplete(user, now);
        return outcome;
    }

    // ---------------------------------------------------------------- the daily lesson

    /**
     * The lesson to do now. The plan is chosen once from the fixed course sequence: the next grammar lesson not yet passed, the next new words and
     * the next new phrasal verbs that no earlier plan has used. An unfinished plan stays as it is until it is finished (so a learner who misses a
     * day simply carries on), and a finished one is replaced by a new plan on the next day.
     */
    @Transactional
    public DailyPlanView today(UUID user) {
        Instant now = clock.instant();
        LocalDate day = today(now);
        DailyPlan latest = store.latestPlan(user).orElse(null);
        if (latest != null) {
            boolean complete = latest.getCompletedAt() != null || state(user, latest, now).complete(); // once finished, a lesson stays finished
            if (complete) latest.completed(now);
            if (!complete || latest.getPlanDate().equals(day)) return view(user, latest, now);
        }
        return view(user, newPlan(user, day, now), now);
    }

    /** Starts another lesson today, once the current one is finished. */
    @Transactional
    public DailyPlanView learnMore(UUID user) {
        Instant now = clock.instant();
        LocalDate day = today(now);
        DailyPlan latest = store.latestPlan(user).orElseThrow(() -> ApiException.badRequest("NO_PLAN", "Open today's lesson first."));
        if (latest.getCompletedAt() == null && !state(user, latest, now).complete()) throw ApiException.conflict("FINISH_FIRST", "Finish the current lesson first.");
        latest.completed(now);
        if (store.plansOn(user, day) >= MAX_PLANS_PER_DAY) throw ApiException.conflict("ENOUGH_FOR_TODAY", "That is plenty for today. Come back tomorrow for the next lesson.");
        return view(user, newPlan(user, day, now), now);
    }

    @Transactional
    public DailyPlanView speakingDone(UUID user) {
        DailyPlan plan = currentPlan(user);
        plan.speakingDone();
        store.touchDay(user, today(clock.instant()));
        markIfComplete(user, clock.instant());
        return view(user, plan, clock.instant());
    }

    /** The ten questions (and a matching exercise) for the new words or the new phrasal verbs of the current daily lesson. */
    @Transactional(readOnly = true)
    public Quiz dailyPractice(UUID user, String part) {
        DailyPlan plan = store.latestPlan(user).orElseThrow(() -> ApiException.badRequest("NO_PLAN", "Open today's lesson first."));
        boolean words = part(part);
        List<String> ids = words ? plan.words() : plan.phrasal();
        if (ids.isEmpty()) throw ApiException.badRequest("NOTHING_TO_PRACTISE", "There is nothing new to practise here.");
        List<QuestionView> out = new ArrayList<>();
        List<String> matchIds = ids.subList(0, Math.min(MATCH_SIZE, ids.size()));
        if (matchIds.size() >= 3) out.add(matchQuestion(plan, part, matchIds));
        for (int i = 0; i < ids.size(); i++) {
            String id = ids.get(i);
            Subject s = curriculum.itemSubject(id).orElseThrow();
            int level = s == Subject.VOCABULARY ? curriculum.word(id).orElseThrow().level() : curriculum.phrasalLesson(id).orElseThrow().level();
            out.add(itemQuestion(id, i % 2 == 0 ? "meaning" : "cloze", s, level));
        }
        return new Quiz("DAILY", part, 0, out);
    }

    /** Grades the daily practice. Every answer updates that word's or phrasal verb's review schedule; the part is done once it has been taken. */
    @Transactional
    public Outcome submitDailyPractice(UUID user, String part, List<AnswerIn> answers) {
        DailyPlan plan = store.latestPlan(user).orElseThrow(() -> ApiException.badRequest("NO_PLAN", "Open today's lesson first."));
        boolean words = part(part);
        List<String> ids = words ? plan.words() : plan.phrasal();
        Map<String, String> given = answerMap(answers);
        String matchId = matchId(plan, part);
        Map<String, String> items = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : given.entrySet()) {
            if (e.getKey().equals(matchId)) continue;
            int colon = e.getKey().indexOf(':');
            if (colon < 0 || !ids.contains(e.getKey().substring(0, colon))) throw ApiException.badRequest("WRONG_QUESTIONS", "Those answers do not belong to today's lesson.");
            items.put(e.getKey(), e.getValue());
        }
        Instant now = clock.instant();
        List<QuestionResult> results = new ArrayList<>();
        if (given.containsKey(matchId)) {
            List<String> matchIds = ids.subList(0, Math.min(MATCH_SIZE, ids.size()));
            results.add(gradeMatch(matchId, matchIds, given.get(matchId)));
        }
        results.addAll(items.isEmpty() ? List.of() : gradeAndRecord(user, items, now).results());
        if (results.isEmpty()) throw ApiException.badRequest("NO_ANSWERS", "There is nothing to submit.");
        int correct = (int) results.stream().filter(QuestionResult::correct).count();
        store.addResult(user, "DAILY", words ? "VOCABULARY" : "PHRASAL", "daily:" + plan.getSeq(), correct, results.size(), now);
        if (words) plan.wordsDone();
        else plan.phrasalDone();
        store.touchDay(user, today(now));
        markIfComplete(user, now);
        int percent = percent(correct, results.size());
        return new Outcome(correct, results.size(), percent, percent >= PASS_PERCENT, false, results);
    }

    private DailyPlan currentPlan(UUID user) {
        return store.latestPlan(user).orElseThrow(() -> ApiException.badRequest("NO_PLAN", "Open today's lesson first."));
    }

    private static boolean part(String part) {
        return switch (part) {
            case "vocabulary" -> true;
            case "phrasal" -> false;
            default -> throw ApiException.notFound("PART_NOT_FOUND", "That part of the lesson does not exist.");
        };
    }

    private static String matchId(DailyPlan plan, String part) { return "m:" + plan.getSeq() + ":" + part; }

    private QuestionView matchQuestion(DailyPlan plan, String part, List<String> ids) {
        List<String> left = new ArrayList<>(), right = new ArrayList<>();
        for (String id : ids) {
            left.add(labelOf(id));
            right.add(meaningOf(id));
        }
        Collections.shuffle(right, random);
        return new QuestionView(matchId(plan, part), "match", "Match each " + (part.equals("vocabulary") ? "word" : "phrasal verb") + " with its meaning.", null, null, left, right);
    }

    /** The answer is "label=>meaning" pairs joined by "||". It is correct only when every pair is right. */
    private QuestionResult gradeMatch(String questionId, List<String> ids, String answer) {
        Map<String, String> expected = new LinkedHashMap<>();
        for (String id : ids) expected.put(labelOf(id), meaningOf(id));
        Map<String, String> given = new HashMap<>();
        for (String pair : answer == null ? new String[0] : answer.split("\\|\\|")) {
            int arrow = pair.indexOf("=>");
            if (arrow > 0) given.put(pair.substring(0, arrow).strip(), pair.substring(arrow + 2).strip());
        }
        boolean ok = expected.size() == given.size() && expected.entrySet().stream().allMatch(e -> e.getValue().equals(given.get(e.getKey())));
        String correct = expected.entrySet().stream().map(e -> e.getKey() + " = " + e.getValue()).collect(Collectors.joining("; "));
        return new QuestionResult(questionId, ok, answer == null ? "" : answer, correct, "Each one goes with its own meaning.");
    }

    private String labelOf(String id) {
        return curriculum.word(id).map(Word::word).orElseGet(() -> curriculum.phrasalLesson(id).map(PhrasalLesson::verb).orElseThrow());
    }

    private String meaningOf(String id) {
        return curriculum.word(id).map(Word::meaning).orElseGet(() -> curriculum.phrasalLesson(id).map(PhrasalLesson::meaning).orElseThrow());
    }

    private record PlanState(boolean grammarDone, boolean wordsDone, boolean phrasalDone, boolean revisionDone, boolean revisionNeeded, boolean speakingDone, int total, int done, long due) {
        boolean complete() { return done == total; }
    }

    private PlanState state(UUID user, DailyPlan plan, Instant now) {
        Map<String, LessonProgress> lessons = store.lessonProgress(user);
        long due = store.dueCount(user, now);
        boolean grammarPresent = plan.getGrammarId() != null;
        LessonProgress lp = grammarPresent ? lessons.get(plan.getGrammarId()) : null;
        boolean grammarDone = !grammarPresent || (lp != null && (lp.isCompleted() || lp.getAttempts() >= 2));
        boolean wordsPresent = !plan.words().isEmpty(), phrasalPresent = !plan.phrasal().isEmpty();
        boolean wordsDone = !wordsPresent || plan.isWordsDone();
        boolean phrasalDone = !phrasalPresent || plan.isPhrasalDone();
        boolean revisionNeeded = due > 0 || plan.isRevisionDone(); // nothing to revise yet means there is no revision part today
        boolean revisionDone = plan.isRevisionDone() || due == 0;
        boolean speakingDone = plan.isSpeakingDone();
        int total = (grammarPresent ? 1 : 0) + (wordsPresent ? 1 : 0) + (phrasalPresent ? 1 : 0) + (revisionNeeded ? 1 : 0) + 1; // the speaking task is always there
        int done = (grammarPresent && grammarDone ? 1 : 0) + (wordsPresent && wordsDone ? 1 : 0) + (phrasalPresent && phrasalDone ? 1 : 0) + (revisionNeeded && revisionDone ? 1 : 0) + (speakingDone ? 1 : 0);
        return new PlanState(grammarDone, wordsDone, phrasalDone, revisionDone, revisionNeeded, speakingDone, total, done, due);
    }

    /** Records the moment the learner finished the lesson, whichever part was the last. */
    private void markIfComplete(UUID user, Instant now) {
        store.latestPlan(user).ifPresent(p -> { if (p.getCompletedAt() == null && state(user, p, now).complete()) p.completed(now); });
    }

    private DailyPlan newPlan(UUID user, LocalDate day, Instant now) {
        Optional<DailyPlan> latest = store.latestPlan(user);
        int seq = latest.map(p -> p.getSeq() + 1).orElse(1);
        Map<String, LessonProgress> lessons = store.lessonProgress(user);
        Map<String, ItemProgress> items = store.items(user);
        Set<String> introduced = new HashSet<>(items.keySet());
        for (DailyPlan p : store.plans(user)) {
            introduced.addAll(p.words());
            introduced.addAll(p.phrasal());
        }
        String grammar = curriculum.allGrammar().stream().filter(l -> !done(lessons, l.id())).map(GrammarLesson::id).findFirst().orElse(null);
        int start = levelFor(user);
        List<String> words = new ArrayList<>();
        for (Word w : wordSequence(start)) {
            if (words.size() >= DAILY_WORDS) break;
            if (!introduced.contains(w.id())) words.add(w.id());
        }
        List<String> phrasal = new ArrayList<>();
        for (PhrasalLesson l : phrasalSequence(start <= 2 ? 1 : start <= 4 ? 2 : 3)) {
            if (phrasal.size() >= DAILY_PHRASAL) break;
            if (!introduced.contains(l.id())) phrasal.add(l.id());
        }
        DailyPlan plan = new DailyPlan(user, day, seq, grammar, words, phrasal, (seq - 1) % SpeakingPrompts.COUNT, now);
        store.save(plan);
        return plan;
    }

    private List<Word> wordSequence(int startLevel) {
        List<Word> out = new ArrayList<>();
        for (int l = startLevel; l <= Curriculum.VOCABULARY_LEVELS; l++) out.addAll(curriculum.wordsOf(l));
        for (int l = 1; l < startLevel; l++) out.addAll(curriculum.wordsOf(l));
        return out;
    }

    private List<PhrasalLesson> phrasalSequence(int startLevel) {
        List<PhrasalLesson> out = new ArrayList<>();
        for (int l = startLevel; l <= Curriculum.PHRASAL_LEVELS; l++) out.addAll(curriculum.phrasalLessons(l));
        for (int l = 1; l < startLevel; l++) out.addAll(curriculum.phrasalLessons(l));
        return out;
    }

    private DailyPlanView view(UUID user, DailyPlan plan, Instant now) {
        PlanState st = state(user, plan, now);
        Map<String, LessonProgress> lessons = store.lessonProgress(user);
        Map<String, ItemProgress> items = store.items(user);
        GrammarPart grammar = null;
        if (plan.getGrammarId() != null) {
            GrammarLesson l = curriculum.grammarLesson(plan.getGrammarId()).orElseThrow();
            LessonProgress lp = lessons.get(l.id());
            grammar = new GrammarPart(l.id(), l.title(), l.level(), lessonStatus(lp), lp == null ? 0 : lp.getBestPercent(), lp == null ? 0 : lp.getAttempts(), st.grammarDone());
        }
        PlanPart words = new PlanPart(plan.words().stream().map(id -> planItem(id, items.get(id))).toList(), st.wordsDone());
        PlanPart phrasal = new PlanPart(plan.phrasal().stream().map(id -> planItem(id, items.get(id))).toList(), st.phrasalDone());
        List<String> w = plan.words().stream().limit(3).map(this::labelOf).toList();
        String pv = plan.phrasal().isEmpty() ? null : labelOf(plan.phrasal().get(0));
        SpeakingPart speaking = new SpeakingPart(SpeakingPrompts.compose(plan.getSpeakingIdx(), w, pv), "FREE_CONVERSATION", st.speakingDone());
        boolean complete = plan.getCompletedAt() != null || st.complete();
        LocalDate day = today(now);
        List<LocalDate> days = store.days(user, day.minusDays(400));
        Set<String> introduced = new HashSet<>(items.keySet());
        for (DailyPlan p : store.plans(user)) {
            introduced.addAll(p.words());
            introduced.addAll(p.phrasal());
        }
        Remaining remaining = new Remaining((int) curriculum.allGrammar().stream().filter(l -> !done(lessons, l.id()) && !l.id().equals(plan.getGrammarId())).count(),
                (int) curriculum.allWords().stream().filter(x -> !introduced.contains(x.id())).count(),
                (int) curriculum.allPhrasal().stream().filter(x -> !introduced.contains(x.id())).count());
        boolean canMore = complete && store.plansOn(user, day) < MAX_PLANS_PER_DAY && (remaining.grammarLessons() > 0 || remaining.words() > 0 || remaining.phrasalVerbs() > 0);
        return new DailyPlanView(plan.getSeq(), plan.getPlanDate(), complete, st.done(), st.total(), grammar, words, phrasal, new RevisionPart(st.due(), st.revisionDone(), st.revisionNeeded()),
                speaking, streak(days, day), canMore, remaining);
    }

    private PlanItem planItem(String id, ItemProgress p) {
        return curriculum.word(id).map(w -> new PlanItem(w.id(), w.word(), w.meaning(), w.kn(), status(p)))
                .orElseGet(() -> curriculum.phrasalLesson(id).map(l -> new PlanItem(l.id(), l.verb(), l.meaning(), l.kn(), status(p))).orElseThrow());
    }

    private TodaySummary todaySummary(UUID user, Map<String, LessonProgress> lessons, Map<String, ItemProgress> items) {
        Optional<DailyPlan> latest = store.latestPlan(user);
        if (latest.isEmpty()) return null;
        PlanState st = state(user, latest.get(), clock.instant());
        return new TodaySummary(latest.get().getSeq(), st.complete(), st.done(), st.total());
    }

    // ---------------------------------------------------------------- progress

    @Transactional(readOnly = true)
    public Progress progress(UUID user) {
        Instant now = clock.instant();
        Map<String, LessonProgress> lessons = store.lessonProgress(user);
        Map<String, ItemProgress> items = store.items(user);
        long grammarDone = curriculum.allGrammar().stream().filter(l -> done(lessons, l.id())).count();
        long phrasalDone = curriculum.allPhrasal().stream().filter(l -> done(lessons, l.id())).count();
        long wordsLearned = curriculum.allWords().stream().filter(w -> items.get(w.id()) != null && items.get(w.id()).isLearned()).count();
        long wordsSaved = curriculum.allWords().stream().filter(w -> items.get(w.id()) != null && items.get(w.id()).isSaved()).count();
        long phrasalLearned = curriculum.allPhrasal().stream().filter(l -> items.get(l.id()) != null && items.get(l.id()).isLearned()).count();

        List<AssessmentResult> recent = store.recentResults(user, 20);
        Integer average = recent.isEmpty() ? null : (int) Math.round(recent.stream().mapToInt(AssessmentResult::percent).average().orElse(0));
        List<RecentResult> recentRows = recent.stream().limit(8).map(r -> new RecentResult(r.getKind(), r.getSubject(), label(r), r.percent(), r.getCorrect(), r.getTotal(), r.getTakenAt())).toList();

        List<LocalDate> days = store.days(user, today(now).minusDays(400));
        Instant tomorrow = today(now).plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC);
        Instant dayAfter = tomorrow.plus(Duration.ofDays(1));
        Instant week = today(now).plusDays(7).atStartOfDay().toInstant(ZoneOffset.UTC);
        int daysCompleted = (int) store.plans(user).stream().filter(p -> p.getCompletedAt() != null).count();
        return new Progress((int) grammarDone, curriculum.allGrammar().size(), (int) phrasalDone, curriculum.allPhrasal().size(), (int) wordsLearned, (int) wordsSaved,
                curriculum.allWords().size(), (int) phrasalLearned, curriculum.allPhrasal().size(), average, recentRows, streak(days, today(now)),
                (int) days.stream().filter(d -> !d.isBefore(today(now).minusDays(29))).count(), weakTopics(user, lessons), store.dueCount(user, now),
                store.dueBetween(user, tomorrow, dayAfter), store.dueBetween(user, tomorrow, week), daysCompleted, nextStep(lessons), todaySummary(user, lessons, items));
    }

    // ---------------------------------------------------------------- internals

    private Outcome gradeAndRecord(UUID user, Map<String, String> given, Instant now) {
        List<QuestionResult> results = new ArrayList<>();
        int correct = 0;
        Map<String, int[]> topics = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : given.entrySet()) {
            Question q = curriculum.question(e.getKey()).orElseThrow(() -> ApiException.badRequest("UNKNOWN_QUESTION", "One of the questions does not exist."));
            boolean ok = q.accepts(e.getValue());
            if (ok) correct++;
            results.add(new QuestionResult(q.id(), ok, e.getValue(), q.correctAnswer(), q.why()));
            if (q.lessonId() != null) {
                topics.computeIfAbsent(q.lessonId(), k -> new int[2])[ok ? 0 : 1]++;
            } else {
                String itemId = q.id().substring(0, q.id().indexOf(':'));
                Subject s = curriculum.itemSubject(itemId).orElseThrow();
                store.itemForUpdate(user, itemId, kind(s), now).review(ok, now);
            }
        }
        topics.forEach((lessonId, rw) -> {
            if (curriculum.grammarLesson(lessonId).isPresent()) store.topicStatForUpdate(user, lessonId, now).add(rw[0], rw[1], now);
        });
        int total = results.size();
        return new Outcome(correct, total, percent(correct, total), percent(correct, total) >= PASS_PERCENT, false, results);
    }

    private Map<String, String> answerMap(List<AnswerIn> answers) {
        if (answers == null || answers.isEmpty()) throw ApiException.badRequest("NO_ANSWERS", "There is nothing to submit.");
        if (answers.size() > MAX_ANSWERS) throw ApiException.badRequest("TOO_MANY_ANSWERS", "Too many answers.");
        Map<String, String> out = new LinkedHashMap<>();
        for (AnswerIn a : answers) {
            if (a == null || a.id() == null || a.id().isBlank() || a.id().length() > 40) throw ApiException.badRequest("BAD_ANSWER", "Every answer needs a question.");
            String text = a.answer() == null ? "" : a.answer();
            if (text.length() > 600) throw ApiException.badRequest("ANSWER_TOO_LONG", "An answer is too long.");
            if (out.put(a.id(), text) != null) throw ApiException.badRequest("DUPLICATE_QUESTION", "A question was answered twice.");
        }
        return out;
    }

    private QuestionView itemQuestion(String itemId, String form, Subject subject, int level) {
        Question q = curriculum.question(itemId + ":" + form).orElseThrow();
        if (q.isChoice()) {
            String correct = q.correctAnswer();
            List<String> pool = new ArrayList<>(subject == Subject.VOCABULARY
                    ? curriculum.wordsOf(level).stream().map(Word::word).toList()
                    : curriculum.phrasalLessons(level).stream().map(PhrasalLesson::verb).toList());
            pool.remove(correct);
            Collections.shuffle(pool, random);
            List<String> options = new ArrayList<>(pool.subList(0, Math.min(3, pool.size())));
            options.add(correct);
            Collections.shuffle(options, random);
            return new QuestionView(q.id(), "choice", q.prompt(), options, null, null, null);
        }
        return view(q);
    }

    private static QuestionView view(Question q) {
        return new QuestionView(q.id(), q.type(), q.prompt(), q.isChoice() ? q.options() : null, q.words().isEmpty() ? null : q.words(), null, null);
    }

    private static List<QuestionView> views(List<Question> questions) { return questions.stream().map(LearnService::view).toList(); }

    private ThemeSummary themeSummary(String id, String title, List<String> ids, Map<String, ItemProgress> items) {
        int learned = (int) ids.stream().filter(i -> items.get(i) != null && items.get(i).isLearned()).count();
        return new ThemeSummary(id, title, ids.size(), learned);
    }

    private WordRow wordRow(Word w, ItemProgress p) {
        return new WordRow(w.id(), w.word(), w.pos(), w.meaning(), w.kn(), w.level(), w.theme(), status(p), p != null && p.isSaved(), p != null && p.isDifficult());
    }

    private LessonRow phrasalRow(PhrasalLesson l, ItemProgress p) {
        return new LessonRow(l.id(), l.verb(), status(p), 0, 0, l.meaning(), l.kn(), l.theme(), l.register(), l.separable());
    }

    private SubjectSummary subject(Subject s, String id, String title, String description, String unit, Map<String, LessonProgress> lessons,
                                   Map<String, ItemProgress> items, Map<String, Integer> tests) {
        List<LevelSummary> levels = curriculum.levels(s).stream().map(info -> levelSummary(s, info, lessons, items, tests)).toList();
        int total = levels.stream().mapToInt(LevelSummary::total).sum();
        int completed = levels.stream().mapToInt(LevelSummary::completed).sum();
        return new SubjectSummary(id, title, description, unit, total, completed, levels);
    }

    private LevelSummary levelSummary(Subject s, Curriculum.LevelInfo info, Map<String, LessonProgress> lessons, Map<String, ItemProgress> items, Map<String, Integer> tests) {
        int total, completed;
        switch (s) {
            case GRAMMAR -> {
                List<GrammarLesson> list = curriculum.grammarLessons(info.level());
                total = list.size();
                completed = (int) list.stream().filter(l -> done(lessons, l.id())).count();
            }
            case VOCABULARY -> {
                List<Word> list = curriculum.wordsOf(info.level());
                total = list.size();
                completed = (int) list.stream().filter(w -> items.get(w.id()) != null && items.get(w.id()).isLearned()).count();
            }
            default -> {
                List<PhrasalLesson> list = curriculum.phrasalLessons(info.level());
                total = list.size();
                // A phrasal verb counts as learned like a word: recalled correctly in three separate reviews.
                completed = (int) list.stream().filter(l -> items.get(l.id()) != null && items.get(l.id()).isLearned()).count();
            }
        }
        return new LevelSummary(info.level(), info.title(), info.summary(), total, completed, tests.get(s.name().toLowerCase() + ":" + info.level()));
    }

    private Map<String, Integer> bestLevelTests(UUID user) {
        Map<String, Integer> best = new HashMap<>();
        for (AssessmentResult r : store.levelResults(user)) best.merge(r.getRef(), r.percent(), Math::max);
        return best;
    }

    private static boolean done(Map<String, LessonProgress> lessons, String id) { return lessons.get(id) != null && lessons.get(id).isCompleted(); }

    private LessonRow row(String id, String title, LessonProgress p) {
        return new LessonRow(id, title, lessonStatus(p), p == null ? 0 : p.getBestPercent(), p == null ? 0 : p.getAttempts(), null, null, null, null, null);
    }

    private static String lessonStatus(LessonProgress p) {
        if (p == null) return "NOT_STARTED";
        return p.isCompleted() ? "COMPLETED" : "IN_PROGRESS";
    }

    private static String status(ItemProgress p) {
        if (p == null) return "NEW";
        if (p.isLearned()) return "LEARNED";
        return p.getBox() > 0 || p.isSaved() ? "LEARNING" : "NEW";
    }

    private ItemRow itemRow(String itemId, ItemProgress p) {
        Subject s = curriculum.itemSubject(itemId).orElseThrow();
        return new ItemRow(itemId, s.name().toLowerCase(), labelOf(itemId), meaningOf(itemId), status(p), p != null && p.isSaved(), p != null && p.isDifficult(), p == null ? null : p.getNextReviewAt());
    }

    private static String kind(Subject s) { return s == Subject.VOCABULARY ? "VOCABULARY" : "PHRASAL"; }

    private NextStep nextStep(Map<String, LessonProgress> lessons) {
        for (GrammarLesson l : curriculum.allGrammar()) if (!done(lessons, l.id())) return new NextStep(l.id(), l.title(), "grammar", l.level());
        return null;
    }

    private String nextGrammar(GrammarLesson l) {
        List<GrammarLesson> all = new ArrayList<>(curriculum.allGrammar());
        int i = all.indexOf(l);
        return i >= 0 && i + 1 < all.size() ? all.get(i + 1).id() : null;
    }

    private String nextPhrasal(PhrasalLesson l) {
        List<PhrasalLesson> all = new ArrayList<>(curriculum.allPhrasal());
        int i = all.indexOf(l);
        return i >= 0 && i + 1 < all.size() ? all.get(i + 1).id() : null;
    }

    private List<WeakTopic> weakTopics(UUID user, Map<String, LessonProgress> lessons) {
        Map<String, Integer> accuracy = new LinkedHashMap<>();
        for (TopicStat t : store.topicStats(user).values()) {
            if (t.answered() >= 3 && t.accuracyPercent() < PASS_PERCENT) accuracy.put(t.lessonId(), t.accuracyPercent());
        }
        for (LessonProgress p : lessons.values()) {
            if (!p.isCompleted() && p.getAttempts() > 0 && curriculum.grammarLesson(p.getId().lessonId()).isPresent()) accuracy.merge(p.getId().lessonId(), p.getLastPercent(), Math::min);
        }
        return accuracy.entrySet().stream().sorted(Map.Entry.comparingByValue()).limit(5)
                .map(e -> curriculum.grammarLesson(e.getKey()).map(l -> new WeakTopic(l.id(), l.title(), l.level(), e.getValue())).orElse(null))
                .filter(java.util.Objects::nonNull).toList();
    }

    private String label(AssessmentResult r) {
        return switch (r.getKind()) {
            case "LESSON" -> curriculum.grammarLesson(r.getRef()).map(GrammarLesson::title).or(() -> curriculum.phrasalLesson(r.getRef()).map(PhrasalLesson::verb)).orElse("Lesson test");
            case "LEVEL" -> {
                String[] parts = r.getRef().split(":");
                yield (parts[0].equals("phrasal") ? "Phrasal verbs" : Character.toUpperCase(parts[0].charAt(0)) + parts[0].substring(1)) + " level " + parts[1] + " test";
            }
            case "DAILY" -> "Daily " + (r.getSubject().equals("PHRASAL") ? "phrasal verb" : "vocabulary") + " practice";
            default -> "Revision";
        };
    }

    /** Consecutive practice days ending today, or ending yesterday if today has no practice yet. */
    public static int streak(List<LocalDate> daysNewestFirst, LocalDate today) {
        Set<LocalDate> set = new HashSet<>(daysNewestFirst);
        LocalDate d = set.contains(today) ? today : today.minusDays(1);
        int n = 0;
        while (set.contains(d)) {
            n++;
            d = d.minusDays(1);
        }
        return n;
    }

    private int levelFor(UUID user) {
        EnglishLevel level = profiles.findById(user).map(p -> p.getEnglishLevel()).orElse(null);
        if (level == null) return 1;
        return switch (level) { case A1 -> 1; case A2 -> 2; case B1 -> 3; case B2 -> 4; default -> 5; };
    }

    private static int percent(int correct, int total) { return total == 0 ? 0 : Math.round(100f * correct / total); }

    private static LocalDate today(Instant now) { return now.atZone(ZoneOffset.UTC).toLocalDate(); }
}
