package com.englishspeaking.platform.learn;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/** The real curriculum files: complete, consistent and gradable. A lesson that lacks a required part fails the build. */
class CurriculumTest {
    private static Curriculum curriculum;

    @BeforeAll
    static void load() {
        curriculum = new Curriculum(new ObjectMapper());
        curriculum.load();
    }

    private static List<String> titles(int level) { return curriculum.grammarLessons(level).stream().map(Curriculum.GrammarLesson::title).toList(); }

    @Test
    void hasTheAgreedShape() {
        assertThat(curriculum.levels(Curriculum.Subject.GRAMMAR)).hasSize(5);
        assertThat(curriculum.levels(Curriculum.Subject.VOCABULARY)).hasSize(5);
        assertThat(curriculum.levels(Curriculum.Subject.PHRASAL)).hasSize(3);
        for (int level = 1; level <= 5; level++) assertThat(curriculum.grammarLessons(level).size()).as("grammar level " + level).isGreaterThanOrEqualTo(12);
        assertThat(curriculum.allGrammar()).hasSize(67);
        // Counts are what is actually in the course, not a target: they only ever grow, and the documentation reports the real number.
        assertThat(curriculum.allWords().size()).isGreaterThanOrEqualTo(484);
        assertThat(curriculum.allPhrasal().size()).isGreaterThanOrEqualTo(119);
        for (int level = 1; level <= 5; level++) assertThat(curriculum.wordsOf(level).size()).as("vocabulary level " + level).isGreaterThanOrEqualTo(50);
        for (int level = 1; level <= 3; level++) assertThat(curriculum.phrasalLessons(level).size()).as("phrasal level " + level).isGreaterThanOrEqualTo(25);
    }

    @Test
    void grammarCoversTheWholeAgreedCurriculumInTeachingOrder() {
        assertThat(titles(1)).containsExactly(
                "Basic sentence structure", "Parts of speech", "Nouns", "Pronouns", "Verbs", "Adjectives", "Adverbs", "Articles", "Determiners",
                "Singular and plural", "Interjections", "Subject and predicate", "Subject-verb agreement", "Basic sentence formation");
        assertThat(titles(2)).containsExactly(
                "Present Simple", "Present Continuous", "Present Perfect", "Present Perfect Continuous", "Past Simple", "Past Continuous",
                "Past Perfect", "Past Perfect Continuous", "Future Simple", "Future Continuous", "Future Perfect", "Future Perfect Continuous");
        assertThat(titles(3)).containsExactly(
                "Helping verbs", "Modal verbs", "Question formation", "WH questions", "Yes/No questions", "Negative sentences", "Imperative sentences",
                "There is / There are", "Has / Have / Had", "Do / Does / Did", "Prepositions", "Conjunctions", "Quantifiers");
        assertThat(titles(4)).containsExactly(
                "Active and passive voice", "Direct and indirect speech", "Conditional sentences", "Gerunds", "Infinitives", "Participles",
                "Relative clauses", "Adjective clauses", "Adverb clauses", "Noun clauses", "Comparisons and degrees of comparison", "Question tags", "Punctuation");
        assertThat(titles(5)).containsExactly(
                "Advanced conditionals", "Mixed conditionals", "Inversion", "Cleft sentences", "Subjunctive mood", "Advanced modal structures",
                "Reduced relative clauses", "Compound and complex sentences", "Parallelism", "Ellipsis and substitution", "Advanced reported speech",
                "Common grammatical errors", "Causative structures", "Advanced prepositions", "Formal and informal English");
    }

    @Test
    void lessonIdsNeverChangeWhenLessonsAreInsertedBetweenOthers() {
        assertThat(curriculum.grammarLesson("g1.08").orElseThrow().title()).isEqualTo("Articles");
        assertThat(curriculum.grammarLesson("g1.13").orElseThrow().title()).isEqualTo("Determiners");
        assertThat(curriculum.grammarLesson("g2.03").orElseThrow().title()).isEqualTo("Present Perfect");
        assertThat(curriculum.grammarLesson("g3.03").orElseThrow().title()).isEqualTo("WH questions");
        assertThat(curriculum.grammarLesson("g5.12").orElseThrow().title()).isEqualTo("Common grammatical errors");
    }

    @Test
    void phrasalVerbsIncludeTheAgreedExamplesAtEachLevelInTheAgreedOrder() {
        assertThat(curriculum.phrasalLessons(1).stream().map(Curriculum.PhrasalLesson::verb).limit(10).toList()).containsExactly(
                "wake up", "get up", "sit down", "stand up", "come in", "go out", "find out", "look for", "pick up", "put down");
        assertThat(curriculum.phrasalLessons(2).stream().map(Curriculum.PhrasalLesson::verb).limit(10).toList()).containsExactly(
                "give up", "carry on", "look after", "get along", "run into", "bring up", "turn down", "figure out", "put off", "come across");
        assertThat(curriculum.phrasalLessons(3).stream().map(Curriculum.PhrasalLesson::verb).limit(10).toList()).containsExactly(
                "come up with", "get away with", "look down on", "keep up with", "put up with", "run out of", "get around to", "back out of",
                "brush up on", "follow through");
    }

    @Test
    void noWordOrPhrasalVerbAppearsTwiceAnywhereInTheCourse() {
        var words = curriculum.allWords().stream().map(w -> w.word().toLowerCase()).toList();
        assertThat(words).doesNotHaveDuplicates();
        var verbs = curriculum.allPhrasal().stream().map(l -> l.verb().toLowerCase()).toList();
        assertThat(verbs).doesNotHaveDuplicates();
        // the phrasal verb must not also be taught as a plain word entry
        assertThat(words).doesNotContainAnyElementsOf(verbs);
    }

    @Test
    void everyWordAndPhrasalVerbHasAGroupAndAKannadaMeaningAndEveryGroupIsUsed() {
        for (Curriculum.Word w : curriculum.allWords()) {
            assertThat(Curriculum.WORD_THEMES).as(w.id() + " group").containsKey(w.theme());
            assertThat(w.kn()).as(w.id() + " Kannada").isNotBlank().containsPattern("[\\u0C80-\\u0CFF]");
            assertThat(w.collocation()).as(w.id() + " common usage").isNotBlank();
        }
        for (Curriculum.PhrasalLesson l : curriculum.allPhrasal()) {
            assertThat(Curriculum.PHRASAL_THEMES).as(l.id() + " group").containsKey(l.theme());
            assertThat(Curriculum.REGISTERS).as(l.id() + " register").contains(l.register());
            assertThat(l.kn()).as(l.id() + " Kannada").isNotBlank().containsPattern("[\\u0C80-\\u0CFF]");
            assertThat(l.usage()).as(l.id() + " common usage").isNotBlank();
            assertThat(l.senses()).as(l.id() + " meanings").isNotEmpty();
            for (Curriculum.Sense s : l.senses()) {
                assertThat(s.kn()).as(l.id() + " Kannada for each meaning").containsPattern("[\\u0C80-\\u0CFF]");
                assertThat(s.example()).as(l.id() + " an example for each meaning").isNotBlank();
            }
        }
        for (String theme : Curriculum.WORD_THEMES.keySet()) assertThat(curriculum.wordsOfTheme(theme).size()).as("word group " + theme).isGreaterThan(0);
        // The groups together cover every word exactly once.
        assertThat(Curriculum.WORD_THEMES.keySet().stream().mapToInt(t -> curriculum.wordsOfTheme(t).size()).sum()).isEqualTo(curriculum.allWords().size());
        assertThat(Curriculum.PHRASAL_THEMES.keySet().stream().mapToInt(t -> curriculum.phrasalOfTheme(t).size()).sum()).isEqualTo(curriculum.allPhrasal().size());
    }

    @Test
    void separabilityIsStatedAndMatchesTheNoteForEveryPhrasalVerb() {
        for (Curriculum.PhrasalLesson l : curriculum.allPhrasal()) {
            assertThat(l.separable()).as(l.id()).isIn("SEPARABLE", "INSEPARABLE", "NONE");
            String note = l.note().toLowerCase();
            if (l.separable().equals("SEPARABLE")) assertThat(note).as(l.id() + " says it is separable").contains("separable").doesNotStartWith("not separable");
            // A verb marked as not separable must not be described as separable (the note of an original lesson may add that an object can be added).
            if (l.separable().equals("INSEPARABLE")) assertThat(note).as(l.id()).doesNotStartWith("separable");
        }
    }

    @Test
    void addedContentIsComplete() {
        for (Curriculum.Word w : curriculum.allWords()) {
            assertThat(w.pos()).as(w.id() + " part of speech").isIn("noun", "verb", "adjective", "adverb", "preposition");
            assertThat(w.meaning().length()).as(w.id() + " meaning is short enough to read at a glance").isLessThan(130);
            if (!w.conversation().isEmpty()) {
                assertThat(w.conversation().get(0)).as(w.id()).startsWith("A:");
                assertThat(w.conversation().get(1)).as(w.id()).startsWith("B:");
            }
            assertThat(w.synonyms()).as(w.id() + " a word is not its own synonym").doesNotContain(w.word());
            assertThat(w.antonyms()).as(w.id() + " a word is not its own antonym").doesNotContain(w.word());
            assertThat(w.cloze().toLowerCase()).as(w.id() + " the blank replaces the word, so the answer is not given away").doesNotContain(w.word().toLowerCase());
        }
        for (Curriculum.PhrasalLesson l : curriculum.allPhrasal()) {
            if (l.order() > 10) { // every lesson after the first ten states how the verb takes an object
                assertThat(l.note().toLowerCase()).as(l.id() + " explains how the verb takes an object").containsAnyOf("separable", "no object", "followed");
            }
            assertThat(l.cloze().toLowerCase()).as(l.id() + " the blank replaces the verb").doesNotContain(l.verb().toLowerCase());
            // the learner is told the mistake and the fix, and they are different (also enforced at load time)
            l.mistakes().forEach(m -> assertThat(m.wrong()).as(l.id()).isNotEqualToIgnoringCase(m.right()));
        }
    }

    @Test
    void everyGrammarLessonHasEveryRequiredSection() {
        for (Curriculum.GrammarLesson l : curriculum.allGrammar()) {
            assertThat(l.definition()).as(l.id() + " simple definition").isNotBlank();
            assertThat(l.explain()).as(l.id() + " explanation").isNotBlank();
            assertThat(l.details()).as(l.id() + " more detail").hasSizeGreaterThanOrEqualTo(2);
            assertThat(l.structures()).as(l.id() + " structures").hasSizeGreaterThanOrEqualTo(2);
            assertThat(l.positive()).as(l.id() + " positive examples").hasSizeGreaterThanOrEqualTo(2);
            assertThat(l.negative()).as(l.id() + " negative examples").isNotEmpty();
            assertThat(l.questions()).as(l.id() + " question examples").isNotEmpty();
            assertThat(l.reallife()).as(l.id() + " real-life examples").isNotEmpty();
            assertThat(l.mistakes()).as(l.id() + " common mistakes").isNotEmpty();
            assertThat(l.exercises()).as(l.id() + " exercises").hasSizeGreaterThanOrEqualTo(5);
            assertThat(l.assessment()).as(l.id() + " assessment").hasSizeGreaterThanOrEqualTo(4);
            assertThat(l.exercises().stream().map(Curriculum.Question::type).toList()).as(l.id() + " practice has a word-order exercise and a correct-the-sentence exercise")
                    .contains("reorder", "correct");
        }
    }

    @Test
    void everyVocabularyWordHasEveryRequiredPart() {
        for (Curriculum.Word w : curriculum.allWords()) {
            assertThat(w.word()).as(w.id()).isNotBlank();
            assertThat(w.meaning()).as(w.id() + " meaning").isNotBlank();
            assertThat(w.example()).as(w.id() + " example").isNotBlank();
            assertThat(w.build()).as(w.id() + " sentence-building prompt").isNotBlank();
            assertThat(w.cloze()).as(w.id() + " cloze").contains("___");
            assertThat(w.answers()).as(w.id() + " accepted answers").isNotEmpty();
            // The blank must be answerable: the example sentence of the word itself should contain the word (in some form).
            assertThat(w.example().toLowerCase()).as(w.id() + " example uses the word").containsAnyOf(w.word().toLowerCase().substring(0, Math.min(w.word().length(), Math.max(3, w.word().length() - 3))));
        }
    }

    @Test
    void everyPhrasalVerbLessonHasEveryRequiredPart() {
        for (Curriculum.PhrasalLesson l : curriculum.allPhrasal()) {
            assertThat(l.meaning()).as(l.id() + " meaning").isNotBlank();
            assertThat(l.examples()).as(l.id() + " examples").isNotEmpty();
            if (l.conversation() != null) {
                assertThat(l.conversation().dialogue()).as(l.id() + " conversation practice").hasSizeGreaterThanOrEqualTo(2);
                assertThat(l.conversation().task()).as(l.id() + " practice task").isNotBlank();
            }
            assertThat(l.assessment()).as(l.id() + " tests").hasSizeGreaterThanOrEqualTo(3);
            // the first meaning is the main one, and each example uses the verb
            assertThat(l.senses().get(0).meaning()).as(l.id()).isEqualTo(l.meaning());
        }
        // The first lessons of each level are the fully written ones: conversation, real-life situations and a common mistake.
        for (int level = 1; level <= 3; level++) {
            for (Curriculum.PhrasalLesson l : curriculum.phrasalLessons(level).subList(0, 10)) {
                assertThat(l.reallife()).as(l.id()).isNotEmpty();
                assertThat(l.mistakes()).as(l.id()).isNotEmpty();
                assertThat(l.conversation()).as(l.id()).isNotNull();
            }
        }
    }

    @Test
    void questionIdsAreUniqueAndEveryQuestionCanBeAnswered() {
        Set<String> ids = new HashSet<>();
        List<Curriculum.Question> all = new java.util.ArrayList<>();
        curriculum.allGrammar().forEach(l -> { all.addAll(l.exercises()); all.addAll(l.assessment()); });
        curriculum.allPhrasal().forEach(l -> all.addAll(l.assessment()));
        for (Curriculum.Question q : all) {
            assertThat(ids.add(q.id())).as("unique id " + q.id()).isTrue();
            assertThat(q.prompt()).isNotBlank();
            assertThat(q.why()).as(q.id() + " explanation").isNotBlank();
            assertThat(q.accepts(q.correctAnswer())).as(q.id() + " accepts its own correct answer").isTrue();
            switch (q.type()) {
                case "choice" -> {
                    assertThat(q.options()).hasSizeBetween(2, 4);
                    for (int i = 0; i < q.options().size(); i++) {
                        if (i != q.answerIndex()) assertThat(q.accepts(q.options().get(i))).as(q.id() + " rejects wrong option " + i).isFalse();
                    }
                }
                case "fill" -> assertThat(q.prompt()).contains("___");
                case "reorder" -> {
                    assertThat(q.words()).as(q.id()).hasSizeGreaterThanOrEqualTo(3);
                    for (String a : q.answers()) {
                        List<String> have = Curriculum.tokens(a), want = Curriculum.tokens(String.join(" ", q.words()));
                        Collections.sort(have);
                        Collections.sort(want);
                        assertThat(have).as(q.id() + " uses exactly the words shown").isEqualTo(want);
                    }
                    // Putting the words back in the order given (the shuffled order) is not accepted.
                    assertThat(q.accepts(String.join(" ", q.words()))).as(q.id() + " is not solved by leaving the words as they are").isFalse();
                }
                case "correct" -> assertThat(q.accepts(q.prompt().substring(q.prompt().indexOf(':') + 1))).as(q.id() + " the faulty sentence is not accepted").isFalse();
                default -> throw new AssertionError("unknown type " + q.type());
            }
            assertThat(curriculum.question(q.id())).as("lookup " + q.id()).isPresent();
        }
        assertThat(all.size()).isGreaterThan(700);
    }

    @Test
    void withinALessonTheAssessmentDoesNotRepeatAnExercise() {
        for (Curriculum.GrammarLesson l : curriculum.allGrammar()) {
            Set<String> exercises = new HashSet<>(l.exercises().stream().map(CurriculumTest::key).toList());
            for (Curriculum.Question q : l.assessment()) {
                assertThat(exercises).as(l.id() + " assessment repeats an exercise: " + q.prompt()).doesNotContain(key(q));
            }
        }
    }

    /** A question is the same question only if prompt and options match ("Choose the correct sentence." is a common prompt). */
    private static String key(Curriculum.Question q) { return Curriculum.normalise(q.prompt()) + "|" + String.join("|", q.options()); }

    @Test
    void choicesAreComparedExactlyAndFillAnswersLeniently() {
        Curriculum.Question fill = curriculum.question("g1.01.a3").orElseThrow();
        assertThat(fill.accepts("play")).isTrue();
        assertThat(fill.accepts("  Play. ")).isTrue();
        assertThat(fill.accepts("plays")).isFalse();
        assertThat(fill.accepts("")).isFalse();
        assertThat(fill.accepts(null)).isFalse();
        Curriculum.Question neg = curriculum.question("g3.04.a2").orElseThrow(); // didn't / did not
        assertThat(neg.accepts("didn’t")).isTrue();
        assertThat(neg.accepts("did not")).isTrue();
        Curriculum.Question capitals = curriculum.question("g1.03.a2").orElseThrow(); // options differ only by capital letters
        assertThat(capitals.accepts("My friend lives in Canada.")).isTrue();
        assertThat(capitals.accepts("My friend lives in canada.")).isFalse();
        assertThat(capitals.accepts("my friend lives in Canada.")).isFalse();
    }

    @Test
    void wordOrderAndCorrectTheSentenceQuestionsAreGradedOnTheWholeSentence() {
        Curriculum.GrammarLesson lesson = curriculum.grammarLesson("g1.01").orElseThrow();
        Curriculum.Question reorder = lesson.exercises().stream().filter(q -> q.type().equals("reorder")).findFirst().orElseThrow();
        assertThat(reorder.words()).containsExactlyInAnyOrder("reads", "books", "every", "maria", "day");
        assertThat(reorder.accepts("Maria reads books every day.")).isTrue();
        assertThat(reorder.accepts("maria reads books every day")).as("capitals and the final full stop do not matter").isTrue();
        assertThat(reorder.accepts("books reads Maria every day")).isFalse();
        Curriculum.Question correct = lesson.exercises().stream().filter(q -> q.type().equals("correct")).findFirst().orElseThrow();
        assertThat(correct.accepts("She drinks tea.")).isTrue();
        assertThat(correct.accepts("Drinks tea she.")).isFalse();
        assertThat(correct.accepts("She drink tea.")).isFalse();
    }

    @Test
    void reviewQuestionsAreRebuiltFromTheItem() {
        Curriculum.Word w = curriculum.word("v2.05").orElseThrow();
        Curriculum.Question cloze = curriculum.question("v2.05:cloze").orElseThrow();
        assertThat(cloze.isChoice()).isFalse();
        assertThat(cloze.accepts(w.word())).isTrue();
        assertThat(cloze.accepts("wrong")).isFalse();
        Curriculum.Question meaning = curriculum.question("v2.05:meaning").orElseThrow();
        assertThat(meaning.prompt()).contains(w.meaning());
        assertThat(meaning.accepts(w.word())).isTrue();
        assertThat(meaning.accepts("arrive")).isFalse();
        Curriculum.Question verb = curriculum.question("p1.09:cloze").orElseThrow();
        assertThat(verb.accepts("pick up")).isTrue();
        assertThat(curriculum.question("p1.09:meaning").orElseThrow().accepts("pick up")).isTrue();
        assertThat(curriculum.question("v9.99:cloze")).isEmpty();
        assertThat(curriculum.question("v2.05:nonsense")).isEmpty();
        assertThat(curriculum.question("nonsense")).isEmpty();
    }
}
