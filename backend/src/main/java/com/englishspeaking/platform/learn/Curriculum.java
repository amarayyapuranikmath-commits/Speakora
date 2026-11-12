package com.englishspeaking.platform.learn;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.Map;
import java.util.Optional;

/**
 * The learning content, read from {@code curriculum/*.json} at start-up and validated. It is the single source of lessons,
 * words and questions; nothing here is generated, and the application refuses to start if a lesson is incomplete.
 *
 * <p>Question text lives here on the server, together with the correct answers. Assessments are graded here, so a learner's
 * recorded results can only come from answers that were really checked.
 */
@Component
public class Curriculum {
    public static final int GRAMMAR_LEVELS = 5;
    public static final int VOCABULARY_LEVELS = 5;
    public static final int PHRASAL_LEVELS = 3;

    public enum Subject { GRAMMAR, VOCABULARY, PHRASAL }

    /** The ways words are grouped for browsing (besides level). Every word and phrasal verb belongs to exactly one. */
    public static final Map<String, String> WORD_THEMES = orderedMap(
            "everyday", "Everyday conversation", "education", "Education and college", "workplace", "Workplace and professional English",
            "emotions", "Emotions and feelings", "communication", "Communication", "travel", "Travel", "relationships", "Relationships",
            "health", "Health and daily life", "technology", "Technology", "personality", "Personality and behaviour",
            "academic", "Academic and interview vocabulary", "confusing", "Commonly confused words");

    public static final Map<String, String> PHRASAL_THEMES = orderedMap(
            "everyday", "Everyday communication", "education", "College and education", "workplace", "Workplace and professional communication",
            "relationships", "Relationships", "travel", "Travel", "conversation", "Common conversational expressions");

    public static final Set<String> REGISTERS = Set.of("neutral", "informal", "formal");

    private static Map<String, String> orderedMap(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return Collections.unmodifiableMap(m);
    }

    public record LevelInfo(int level, String title, String summary) {}

    public record Mistake(String wrong, String right, String why) {}

    /**
     * type is "choice" (options + answerIndex), "fill" (a blank), "reorder" (put the shown words in order) or "correct" (rewrite a wrong sentence).
     * Fill, reorder and correct accept any of {@code answers}.
     */
    public record Question(String id, String type, String prompt, List<String> options, int answerIndex, List<String> answers, String why, String lessonId,
                           List<String> words) {
        public Question(String id, String type, String prompt, List<String> options, int answerIndex, List<String> answers, String why, String lessonId) {
            this(id, type, prompt, options, answerIndex, answers, why, lessonId, List.of());
        }

        public boolean isChoice() { return "choice".equals(type); }

        /** The one answer to show as "the correct answer". */
        public String correctAnswer() { return isChoice() ? options.get(answerIndex) : answers.get(0); }

        public boolean accepts(String given) {
            if (given == null) return false;
            if (isChoice()) return exact(given).equals(exact(options.get(answerIndex))); // capitals and punctuation matter in a choice
            String g = normalise(given);
            if (g.isEmpty()) return false;
            return answers.stream().anyMatch(a -> normalise(a).equals(g));
        }
    }

    public record GrammarLesson(String id, int level, int order, String title, String definition, String explain, List<String> details, List<String> structures,
                                List<String> positive, List<String> negative, List<String> questions, List<String> reallife, List<Mistake> mistakes,
                                List<Question> exercises, List<Question> assessment) {}

    /**
     * A vocabulary word. {@code kn} is the meaning in Kannada (shown only to learners who chose Kannada as their support language),
     * {@code collocation} how the word is commonly used, {@code theme} one of {@link #WORD_THEMES}, {@code note} an optional usage warning
     * (for commonly confused words). {@code conversation} may be empty for words added without one.
     */
    public record Word(String id, int level, int order, String word, String pos, String meaning, String kn, String example, String collocation, String theme,
                       String note, List<String> conversation, List<String> synonyms, List<String> antonyms, String build, String cloze, List<String> answers) {}

    public record Conversation(List<String> dialogue, String task) {}

    /** One meaning of a phrasal verb, with its own example and Kannada meaning. */
    public record Sense(String meaning, String kn, String example) {}

    /**
     * A phrasal verb. {@code separable} is SEPARABLE, INSEPARABLE or NONE (no object, or not stated). {@code senses} lists every meaning taught
     * (the first is the main one, repeated in {@code meaning}). {@code usage} is common usage; {@code register} is neutral, informal or formal.
     */
    public record PhrasalLesson(String id, int level, int order, String verb, String meaning, String kn, String note, String separable, String usage, String theme,
                                String register, List<Sense> senses, List<String> examples, List<String> reallife, List<Mistake> mistakes,
                                Conversation conversation, String cloze, List<String> answers, List<Question> assessment) {}

    private final ObjectMapper mapper;
    private final Map<Integer, LevelInfo> grammarLevels = new LinkedHashMap<>();
    private final Map<Integer, LevelInfo> vocabularyLevels = new LinkedHashMap<>();
    private final Map<Integer, LevelInfo> phrasalLevels = new LinkedHashMap<>();
    private final Map<String, GrammarLesson> grammar = new LinkedHashMap<>();
    private final Map<String, Word> words = new LinkedHashMap<>();
    private final Map<String, PhrasalLesson> phrasal = new LinkedHashMap<>();
    private final Map<String, Question> questions = new LinkedHashMap<>();

    public Curriculum(ObjectMapper mapper) { this.mapper = mapper; }

    @PostConstruct
    public void load() {
        grammarLevels.clear(); vocabularyLevels.clear(); phrasalLevels.clear();
        grammar.clear(); words.clear(); phrasal.clear(); questions.clear();
        JsonNode details = read("curriculum/grammar-details.json");
        for (int level = 1; level <= GRAMMAR_LEVELS; level++) loadGrammar(level, details);
        details.fieldNames().forEachRemaining(id -> { if (!grammar.containsKey(id)) throw bad(id, "grammar-details.json describes a lesson that does not exist"); });
        for (int level = 1; level <= VOCABULARY_LEVELS; level++) loadVocabulary(level);
        for (int level = 1; level <= PHRASAL_LEVELS; level++) loadPhrasal(level);
    }

    // ---------------------------------------------------------------- lookups

    public List<LevelInfo> levels(Subject s) { return List.copyOf(levelMap(s).values()); }

    public Optional<LevelInfo> level(Subject s, int level) { return Optional.ofNullable(levelMap(s).get(level)); }

    public List<GrammarLesson> grammarLessons(int level) { return grammar.values().stream().filter(l -> l.level() == level).toList(); }

    public List<PhrasalLesson> phrasalLessons(int level) { return phrasal.values().stream().filter(l -> l.level() == level).toList(); }

    public List<Word> wordsOf(int level) { return words.values().stream().filter(w -> w.level() == level).toList(); }

    public List<Word> wordsOfTheme(String theme) { return words.values().stream().filter(w -> theme.equals(w.theme())).toList(); }

    public List<PhrasalLesson> phrasalOfTheme(String theme) { return phrasal.values().stream().filter(l -> theme.equals(l.theme())).toList(); }

    public Optional<GrammarLesson> grammarLesson(String id) { return Optional.ofNullable(grammar.get(id)); }

    public Optional<PhrasalLesson> phrasalLesson(String id) { return Optional.ofNullable(phrasal.get(id)); }

    public Optional<Word> word(String id) { return Optional.ofNullable(words.get(id)); }

    public Collection<GrammarLesson> allGrammar() { return Collections.unmodifiableCollection(grammar.values()); }

    public Collection<Word> allWords() { return Collections.unmodifiableCollection(words.values()); }

    public Collection<PhrasalLesson> allPhrasal() { return Collections.unmodifiableCollection(phrasal.values()); }

    /** The subject an item (word or phrasal verb) belongs to, or empty if the id is unknown. */
    public Optional<Subject> itemSubject(String itemId) {
        if (words.containsKey(itemId)) return Optional.of(Subject.VOCABULARY);
        if (phrasal.containsKey(itemId)) return Optional.of(Subject.PHRASAL);
        return Optional.empty();
    }

    /**
     * Finds a question by id, whatever its kind: a fixed exercise or assessment question ("g1.01.a2"), or a generated review
     * question for a word or phrasal verb ("v2.05:cloze", "p1.03:meaning"). Review questions are rebuilt from the item, so the
     * correct answer is always the server's.
     */
    public Optional<Question> question(String id) {
        Question fixed = questions.get(id);
        if (fixed != null) return Optional.of(fixed);
        int colon = id.indexOf(':');
        if (colon < 0) return Optional.empty();
        String itemId = id.substring(0, colon), form = id.substring(colon + 1);
        Word w = words.get(itemId);
        if (w != null) {
            if ("cloze".equals(form)) return Optional.of(new Question(id, "fill", "Fill in the blank: " + w.cloze(), List.of(), -1, w.answers(), w.example(), null));
            if ("meaning".equals(form)) return Optional.of(meaningQuestion(id, w.meaning(), w.word(), List.of(w.word())));
        }
        PhrasalLesson p = phrasal.get(itemId);
        if (p != null) {
            if ("cloze".equals(form)) return Optional.of(new Question(id, "fill", "Fill in the blank with the phrasal verb: " + p.cloze(), List.of(), -1, p.answers(), p.meaning(), null));
            if ("meaning".equals(form)) return Optional.of(meaningQuestion(id, p.meaning(), p.verb(), List.of(p.verb())));
        }
        return Optional.empty();
    }

    private static Question meaningQuestion(String id, String meaning, String answer, List<String> options) {
        return new Question(id, "choice", "Which one means: " + meaning + "?", options, 0, List.of(), "The answer is " + answer + ".", null);
    }

    private Map<Integer, LevelInfo> levelMap(Subject s) {
        return switch (s) { case GRAMMAR -> grammarLevels; case VOCABULARY -> vocabularyLevels; case PHRASAL -> phrasalLevels; };
    }

    // ---------------------------------------------------------------- loading and validation

    private void loadGrammar(int level, JsonNode details) {
        JsonNode root = read("curriculum/grammar-" + level + ".json");
        grammarLevels.put(level, levelInfo(root, level));
        int order = 0;
        for (JsonNode n : root.path("lessons")) {
            order++;
            String id = text(n, "id");
            if (!id.matches("g" + level + "\\.\\d\\d")) throw bad(id, "lesson id must look like g" + level + ".01");
            JsonNode extra = details.path(id);
            if (extra.isMissingNode()) throw bad(id, "grammar-details.json has no definition and extra notes for this lesson");
            List<Question> exercises = new ArrayList<>(questions(n.path("exercises"), id, "e", 0));
            exercises.addAll(questions(extra.path("exercises"), id, "e", exercises.size()));
            List<Question> assessment = questions(n.path("assessment"), id, "a", 0);
            GrammarLesson lesson = new GrammarLesson(id, level, order, text(n, "title"), text(extra, "definition"), text(n, "explain"), strings(extra, "details", 2, id),
                    strings(n, "structures", 2, id), strings(n, "positive", 2, id), strings(n, "negative", 1, id), strings(n, "questions", 1, id),
                    strings(n, "reallife", 1, id), mistakes(n, id, true), exercises, assessment);
            if (exercises.size() < 4) throw bad(id, "needs at least 4 exercises");
            if (assessment.size() < 4) throw bad(id, "needs at least 4 assessment questions");
            if (grammar.put(id, lesson) != null) throw bad(id, "duplicate lesson id");
            exercises.forEach(q -> register(q));
            assessment.forEach(q -> register(q));
        }
        if (grammarLessons(level).size() < 12) throw bad("grammar-" + level, "each grammar level has at least 12 topics");
    }

    private void loadVocabulary(int level) {
        JsonNode root = read("curriculum/vocabulary-" + level + ".json");
        vocabularyLevels.put(level, levelInfo(root, level));
        int order = 0;
        for (JsonNode n : root.path("words")) {
            order++;
            String id = text(n, "id");
            if (!id.matches("v" + level + "\\.\\d{2,3}")) throw bad(id, "word id must look like v" + level + ".01 (two or three digits)");
            List<String> answers = strings(n, "answers", 1, id);
            String cloze = text(n, "cloze");
            if (!cloze.contains("___")) throw bad(id, "cloze sentence needs a ___ blank");
            List<String> conversation = optionalStrings(n, "conversation");
            if (!conversation.isEmpty() && conversation.size() < 2) throw bad(id, "a conversation needs at least two lines");
            String theme = text(n, "theme");
            if (!WORD_THEMES.containsKey(theme)) throw bad(id, "unknown theme " + theme);
            Word w = new Word(id, level, order, text(n, "word"), text(n, "pos"), text(n, "meaning"), text(n, "kn"), text(n, "example"), text(n, "collocation"), theme,
                    optionalText(n, "note"), conversation, optionalStrings(n, "synonyms"), optionalStrings(n, "antonyms"), text(n, "build"), cloze, answers);
            if (words.put(id, w) != null || phrasal.containsKey(id)) throw bad(id, "duplicate id");
        }
        if (wordsOf(level).size() < 15) throw bad("vocabulary-" + level, "needs at least 15 words");
        Set<String> seen = new HashSet<>();
        for (Word w : wordsOf(level)) if (!seen.add(normalise(w.word()))) throw bad(w.id(), "duplicate word \"" + w.word() + "\"");
    }

    private void loadPhrasal(int level) {
        JsonNode root = read("curriculum/phrasal-" + level + ".json");
        phrasalLevels.put(level, levelInfo(root, level));
        int order = 0;
        for (JsonNode n : root.path("lessons")) {
            order++;
            String id = text(n, "id");
            if (!id.matches("p" + level + "\\.\\d{2,3}")) throw bad(id, "lesson id must look like p" + level + ".01 (two or three digits)");
            String cloze = text(n, "cloze");
            if (!cloze.contains("___")) throw bad(id, "cloze sentence needs a ___ blank");
            Conversation conversation = null;
            JsonNode conv = n.path("conversation");
            if (!conv.isMissingNode() && !conv.isNull()) conversation = new Conversation(strings(conv, "dialogue", 2, id), text(conv, "task"));
            List<Question> assessment = questions(n.path("assessment"), id, "a", 0);
            if (assessment.size() < 3) throw bad(id, "needs at least 3 test questions");
            String separable = text(n, "separable");
            if (!Set.of("SEPARABLE", "INSEPARABLE", "NONE").contains(separable)) throw bad(id, "separable must be SEPARABLE, INSEPARABLE or NONE");
            String theme = text(n, "theme");
            if (!PHRASAL_THEMES.containsKey(theme)) throw bad(id, "unknown theme " + theme);
            String register = text(n, "register");
            if (!REGISTERS.contains(register)) throw bad(id, "unknown register " + register);
            List<Sense> senses = new ArrayList<>();
            for (JsonNode s : n.path("senses")) senses.add(new Sense(text(s, "meaning"), text(s, "kn"), text(s, "example")));
            if (senses.isEmpty()) throw bad(id, "needs at least one meaning with an example");
            if (!senses.get(0).meaning().equals(text(n, "meaning"))) throw bad(id, "the first sense must be the main meaning");
            PhrasalLesson lesson = new PhrasalLesson(id, level, order, text(n, "verb"), text(n, "meaning"), text(n, "kn"), text(n, "note"), separable, text(n, "usage"), theme,
                    register, List.copyOf(senses), strings(n, "examples", 1, id), optionalStrings(n, "reallife"), mistakes(n, id, false), conversation, cloze,
                    strings(n, "answers", 1, id), assessment);
            if (phrasal.put(id, lesson) != null || words.containsKey(id)) throw bad(id, "duplicate id");
            assessment.forEach(q -> register(q));
        }
        if (phrasalLessons(level).size() < 10) throw bad("phrasal-" + level, "needs at least 10 verbs");
        Set<String> verbs = new HashSet<>();
        for (PhrasalLesson l : phrasalLessons(level)) if (!verbs.add(normalise(l.verb()))) throw bad(l.id(), "duplicate phrasal verb \"" + l.verb() + "\"");
    }

    private void register(Question q) {
        if (questions.put(q.id(), q) != null) throw bad(q.id(), "duplicate question id");
    }

    /** Questions of one lesson. {@code start} lets a second source continue the numbering, so ids of earlier questions never change. */
    private List<Question> questions(JsonNode array, String lessonId, String prefix, int start) {
        List<Question> out = new ArrayList<>();
        int n = start;
        for (JsonNode q : array) {
            n++;
            String id = lessonId + "." + prefix + n;
            String type = text(q, "type"), prompt = text(q, "prompt"), why = text(q, "why");
            switch (type) {
                case "choice" -> {
                    List<String> options = strings(q, "options", 2, id);
                    int answer = q.path("answer").asInt(-1);
                    if (answer < 0 || answer >= options.size()) throw bad(id, "answer index out of range");
                    if (new HashSet<>(options.stream().map(Curriculum::exact).toList()).size() != options.size()) throw bad(id, "options must be different");
                    out.add(new Question(id, type, prompt, options, answer, List.of(), why, lessonId));
                }
                case "fill" -> {
                    if (!prompt.contains("___")) throw bad(id, "fill prompt needs a ___ blank");
                    out.add(new Question(id, type, prompt, List.of(), -1, strings(q, "answers", 1, id), why, lessonId));
                }
                case "correct" -> {
                    List<String> answers = strings(q, "answers", 1, id);
                    String faulty = prompt.contains(":") ? prompt.substring(prompt.indexOf(':') + 1) : prompt;
                    if (answers.stream().anyMatch(a -> normalise(faulty).equals(normalise(a)))) throw bad(id, "the sentence to correct is already correct");
                    out.add(new Question(id, type, prompt, List.of(), -1, answers, why, lessonId));
                }
                case "reorder" -> {
                    List<String> shown = strings(q, "words", 3, id);
                    List<String> answers = strings(q, "answers", 1, id);
                    for (String a : answers) {
                        List<String> have = tokens(a), want = tokens(String.join(" ", shown));
                        Collections.sort(have);
                        Collections.sort(want);
                        if (!have.equals(want)) throw bad(id, "the words shown must be exactly the words of the answer \"" + a + "\"");
                    }
                    if (answers.stream().anyMatch(a -> tokens(a).equals(tokens(String.join(" ", shown))))) throw bad(id, "the words are already in the right order");
                    out.add(new Question(id, type, prompt, List.of(), -1, answers, why, lessonId, shown));
                }
                default -> throw bad(id, "unknown question type " + type);
            }
        }
        return out;
    }

    /** Lower-case words of a sentence without punctuation, for checking that a reorder question uses exactly the words of its answer. */
    static List<String> tokens(String sentence) {
        List<String> out = new ArrayList<>();
        for (String t : normalise(sentence).replace(",", " ").replace(";", " ").replace("?", " ").replace("!", " ").split("\\s+")) {
            String w = t.replaceAll("^[^\\p{L}\\p{N}']+|[^\\p{L}\\p{N}']+$", "");
            if (!w.isEmpty()) out.add(w);
        }
        return out;
    }

    private List<Mistake> mistakes(JsonNode n, String id, boolean required) {
        List<Mistake> out = new ArrayList<>();
        for (JsonNode m : n.path("mistakes")) {
            Mistake mk = new Mistake(text(m, "wrong"), text(m, "right"), text(m, "why"));
            if (exact(mk.wrong()).equals(exact(mk.right()))) throw bad(id, "a mistake must differ from its correction");
            out.add(mk);
        }
        if (required && out.isEmpty()) throw bad(id, "needs at least one common mistake");
        return List.copyOf(out);
    }

    private LevelInfo levelInfo(JsonNode root, int level) {
        if (root.path("level").asInt() != level) throw bad("level " + level, "file declares a different level");
        return new LevelInfo(level, text(root, "title"), text(root, "summary"));
    }

    private JsonNode read(String path) {
        try (InputStream in = new ClassPathResource(path).getInputStream()) {
            return mapper.readTree(in);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read curriculum file " + path + ": " + e.getMessage(), e);
        }
    }

    private static String text(JsonNode n, String field) {
        String v = n.path(field).asText("").strip();
        if (v.isEmpty()) throw new IllegalStateException("Curriculum error: missing '" + field + "' in " + n.path("id").asText(n.toString().substring(0, Math.min(60, n.toString().length()))));
        return v;
    }

    private static String optionalText(JsonNode n, String field) {
        String v = n.path(field).asText("").strip();
        return v.isEmpty() ? null : v;
    }

    private static List<String> strings(JsonNode n, String field, int min, String id) {
        List<String> out = optionalStrings(n, field);
        if (out.size() < min) throw bad(id, "'" + field + "' needs at least " + min + " entries");
        return out;
    }

    private static List<String> optionalStrings(JsonNode n, String field) {
        List<String> out = new ArrayList<>();
        for (JsonNode s : n.path(field)) {
            String v = s.asText("").strip();
            if (v.isEmpty()) throw new IllegalStateException("Curriculum error: blank entry in '" + field + "'");
            out.add(v);
        }
        return List.copyOf(out);
    }

    private static IllegalStateException bad(String id, String problem) {
        return new IllegalStateException("Curriculum error in " + id + ": " + problem);
    }

    /** The text of a choice exactly as shown: only surrounding space and Unicode form are ignored. */
    static String exact(String s) { return Normalizer.normalize(s, Normalizer.Form.NFKC).strip(); }

    /** Lower case, one apostrophe style, no trailing punctuation, single spaces: how an answer is compared. */
    public static String normalise(String s) {
        String t = Normalizer.normalize(s, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT)
                .replace('’', '\'').replace('‘', '\'').replace('`', '\'');
        t = t.strip().replaceAll("\\s+", " ");
        t = t.replaceAll("[.!?]+$", "").strip();
        return t;
    }

    /** For tests and tools: the words of every theme, in course order. */
    List<String> themeIds(Subject s) { return Arrays.asList((s == Subject.PHRASAL ? PHRASAL_THEMES : WORD_THEMES).keySet().toArray(new String[0])); }
}
