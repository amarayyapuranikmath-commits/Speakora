package com.englishspeaking.platform.learn;

import java.util.List;

/**
 * The short speaking task of the daily lesson. The topics follow a fixed order (one a day, then round again), and each task asks the learner to use
 * words and a phrasal verb from that day's lesson, so speaking practice is tied to what was learned. Completing the task is the learner's own report:
 * the app does not listen to or judge speech.
 */
final class SpeakingPrompts {
    private static final List<String> TOPICS = List.of(
            "Introduce yourself: your name, where you live and what you do.",
            "Describe your morning routine, from waking up to leaving home.",
            "Talk about your family or your close friends.",
            "Describe your favourite food and how it is made.",
            "Talk about what you did last weekend.",
            "Describe your town or village to a visitor.",
            "Say what you plan to do next weekend.",
            "Talk about a hobby you enjoy and why you like it.",
            "Describe a problem you had and how you solved it.",
            "Give directions from your home to the nearest shop.",
            "Talk about your job or your studies.",
            "Describe a person you admire and say why.",
            "Talk about a trip you remember well.",
            "Say what you would do if you won a big prize.",
            "Describe your perfect day from morning to night.",
            "Explain how to make a cup of tea or cook a simple dish.",
            "Talk about a film, a book or a song you like.",
            "Describe how you travel to work or college every day.",
            "Talk about how technology helps you in daily life.",
            "Give advice to a friend who wants to learn English.",
            "Talk about a festival you celebrate and how you celebrate it.",
            "Describe something you bought recently.",
            "Talk about your goals for this year.",
            "Describe how your life is different from five years ago.");

    static final int COUNT = TOPICS.size();

    private SpeakingPrompts() {}

    /** The topic for the day, with a sentence that asks for up to three of the day's words and one phrasal verb. */
    static String compose(int index, List<String> words, String phrasalVerb) {
        StringBuilder s = new StringBuilder("Speak aloud for about one minute. ").append(TOPICS.get(Math.floorMod(index, COUNT)));
        if (!words.isEmpty() || phrasalVerb != null) {
            s.append(" Try to use");
            if (!words.isEmpty()) s.append(" the words ").append(String.join(", ", words));
            if (!words.isEmpty() && phrasalVerb != null) s.append(" and");
            if (phrasalVerb != null) s.append(" the phrasal verb \"").append(phrasalVerb).append("\"");
            s.append('.');
        }
        return s.toString();
    }
}
