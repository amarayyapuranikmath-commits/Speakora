package com.englishspeaking.platform.learn;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/** The score of one test. Only the score is kept, never the answers the learner typed. */
@Entity
@Table(name = "assessment_results")
public class AssessmentResult {
    @Id
    private UUID id;
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;
    @Column(nullable = false, updatable = false)
    private String kind;
    @Column(nullable = false, updatable = false)
    private String subject;
    @Column(nullable = false, updatable = false)
    private String ref;
    @Column(nullable = false, updatable = false)
    private int correct;
    @Column(nullable = false, updatable = false)
    private int total;
    @Column(name = "taken_at", nullable = false, updatable = false)
    private Instant takenAt;

    protected AssessmentResult() {}

    public AssessmentResult(UUID userId, String kind, String subject, String ref, int correct, int total, Instant takenAt) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.kind = kind;
        this.subject = subject;
        this.ref = ref;
        this.correct = correct;
        this.total = total;
        this.takenAt = takenAt;
    }

    public int percent() { return Math.round(100f * correct / total); }

    public String getKind() { return kind; }
    public String getSubject() { return subject; }
    public String getRef() { return ref; }
    public int getCorrect() { return correct; }
    public int getTotal() { return total; }
    public Instant getTakenAt() { return takenAt; }
}
