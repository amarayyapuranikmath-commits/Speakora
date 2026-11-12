package com.englishspeaking.platform.statistics;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface DailyActivityRepository extends JpaRepository<DailyActivity, DailyActivity.Key> {
    @Modifying
    @Query(value = """
            INSERT INTO daily_activity (user_id, activity_date, seconds, calls) VALUES (:userId, :day, :seconds, 1)
            ON CONFLICT (user_id, activity_date)
            DO UPDATE SET seconds = daily_activity.seconds + EXCLUDED.seconds, calls = daily_activity.calls + 1
            """, nativeQuery = true)
    void addActivity(@Param("userId") java.util.UUID userId, @Param("day") LocalDate day, @Param("seconds") int seconds);

    @Query("select a from DailyActivity a where a.id.userId = :userId and a.id.date between :from and :to order by a.id.date")
    List<DailyActivity> findRange(@Param("userId") java.util.UUID userId, @Param("from") LocalDate from, @Param("to") LocalDate to);

    @Query("select coalesce(sum(a.seconds), 0) from DailyActivity a where a.id.userId = :userId and a.id.date between :from and :to")
    long sumSeconds(@Param("userId") java.util.UUID userId, @Param("from") LocalDate from, @Param("to") LocalDate to);
}
