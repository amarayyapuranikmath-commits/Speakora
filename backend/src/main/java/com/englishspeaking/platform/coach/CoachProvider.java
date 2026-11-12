package com.englishspeaking.platform.coach;

/** Source of tutor replies. The implementation talks to Groq's OpenAI-compatible chat completions API. */
public interface CoachProvider {
    boolean isConfigured();

    String modelName();

    /** One reply in a conversation. {@code turns} alternate user / assistant and end with the learner. Nothing is stored. */
    String chat(String system, java.util.List<TutorService.Turn> turns);

    /**
     * Like {@link #chat} but delivers the reply piece by piece as it is produced, so the learner sees it while it is still being
     * written. Returns the complete reply. Providers that cannot stream deliver the whole reply as one piece.
     */
    default String chatStream(String system, java.util.List<TutorService.Turn> turns, java.util.function.Consumer<String> onDelta) {
        String reply = chat(system, turns);
        onDelta.accept(reply);
        return reply;
    }

    /** What went wrong, so callers can tell the learner something useful without leaking provider details. */
    enum Kind { FAILED, RATE_LIMITED, TIMEOUT, UNAVAILABLE }

    class CoachException extends RuntimeException {
        private final Kind kind;
        private int retryAfterSeconds;

        public CoachException(String message) { this(Kind.FAILED, message, null); }

        public CoachException(String message, Throwable cause) { this(Kind.FAILED, message, cause); }

        public CoachException(Kind kind, String message, Throwable cause) { super(message, cause); this.kind = kind; }

        public Kind kind() { return kind; }

        /** How long the provider asked us to wait (Retry-After), or 0 when unknown. */
        public int retryAfterSeconds() { return retryAfterSeconds; }

        public CoachException retryAfter(int seconds) { this.retryAfterSeconds = Math.max(0, seconds); return this; }
    }
}
