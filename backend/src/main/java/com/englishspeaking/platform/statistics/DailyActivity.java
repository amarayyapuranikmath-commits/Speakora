package com.englishspeaking.platform.statistics;

import jakarta.persistence.*;

import java.io.Serializable;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "daily_activity")
public class DailyActivity {
    @Embeddable
    public record Key(@Column(name = "user_id") UUID userId, @Column(name = "activity_date") LocalDate date) implements Serializable {}

    @EmbeddedId
    private Key id;
    @Column(nullable = false)
    private int seconds;
    @Column(nullable = false)
    private int calls;

    protected DailyActivity() {}

    public Key getId() { return id; }
    public int getSeconds() { return seconds; }
    public int getCalls() { return calls; }
}
