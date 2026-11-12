package com.englishspeaking.platform.learn;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * One day's lesson for one learner: which grammar lesson, which new words and which new phrasal verbs, chosen once from the fixed course sequence and
 * then never changed. Only ids and what has been done are stored (no answers). Grammar progress is read from the lesson results, not stored here.
 */
@Entity
@Table(name = "daily_plans")
public class DailyPlan {
    @Id
    private UUID id = UUID.randomUUID();
    @Column(name = "user_id", nullable = false)
    private UUID userId;
    @Column(name = "plan_date", nullable = false)
    private LocalDate planDate;
    @Column(nullable = false)
    private int seq;
    @Column(name = "grammar_id")
    private String grammarId;
    @Column(name = "word_ids", nullable = false)
    private String wordIds = "";
    @Column(name = "phrasal_ids", nullable = false)
    private String phrasalIds = "";
    @Column(name = "speaking_idx", nullable = false)
    private int speakingIdx;
    @Column(name = "words_done", nullable = false)
    private boolean wordsDone;
    @Column(name = "phrasal_done", nullable = false)
    private boolean phrasalDone;
    @Column(name = "revision_done", nullable = false)
    private boolean revisionDone;
    @Column(name = "speaking_done", nullable = false)
    private boolean speakingDone;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "completed_at")
    private Instant completedAt;

    protected DailyPlan() {}

    public DailyPlan(UUID userId, LocalDate planDate, int seq, String grammarId, List<String> wordIds, List<String> phrasalIds, int speakingIdx, Instant now) {
        this.userId = userId;
        this.planDate = planDate;
        this.seq = seq;
        this.grammarId = grammarId;
        this.wordIds = String.join(",", wordIds);
        this.phrasalIds = String.join(",", phrasalIds);
        this.speakingIdx = speakingIdx;
        this.createdAt = now;
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public LocalDate getPlanDate() { return planDate; }
    public int getSeq() { return seq; }
    public String getGrammarId() { return grammarId; }
    public List<String> words() { return wordIds.isEmpty() ? List.of() : Arrays.asList(wordIds.split(",")); }
    public List<String> phrasal() { return phrasalIds.isEmpty() ? List.of() : Arrays.asList(phrasalIds.split(",")); }
    public int getSpeakingIdx() { return speakingIdx; }
    public boolean isWordsDone() { return wordsDone; }
    public boolean isPhrasalDone() { return phrasalDone; }
    public boolean isRevisionDone() { return revisionDone; }
    public boolean isSpeakingDone() { return speakingDone; }
    public Instant getCompletedAt() { return completedAt; }

    public void wordsDone() { wordsDone = true; }
    public void phrasalDone() { phrasalDone = true; }
    public void revisionDone() { revisionDone = true; }
    public void speakingDone() { speakingDone = true; }
    public void completed(Instant now) { if (completedAt == null) completedAt = now; }
}
