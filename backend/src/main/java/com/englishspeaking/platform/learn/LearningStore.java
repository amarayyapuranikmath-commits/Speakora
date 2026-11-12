package com.englishspeaking.platform.learn;

import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Persistence for learning results. Callers run inside a transaction. */
@Component
public class LearningStore {
    private final EntityManager em;

    public LearningStore(EntityManager em) { this.em = em; }

    // ---- lessons

    public Map<String, LessonProgress> lessonProgress(UUID user) {
        Map<String, LessonProgress> out = new HashMap<>();
        em.createQuery("select p from LessonProgress p where p.id.userId = :u", LessonProgress.class).setParameter("u", user)
                .getResultList().forEach(p -> out.put(p.getId().lessonId(), p));
        return out;
    }

    public LessonProgress lessonProgressForUpdate(UUID user, String lessonId, Instant now) {
        LessonProgress p = em.find(LessonProgress.class, new LessonProgress.Key(user, lessonId));
        if (p == null) {
            p = new LessonProgress(user, lessonId, now);
            em.persist(p);
        }
        return p;
    }

    // ---- results

    public void addResult(UUID user, String kind, String subject, String ref, int correct, int total, Instant now) {
        em.persist(new AssessmentResult(user, kind, subject, ref, correct, total, now));
    }

    public List<AssessmentResult> recentResults(UUID user, int limit) {
        return em.createQuery("select a from AssessmentResult a where a.userId = :u order by a.takenAt desc", AssessmentResult.class)
                .setParameter("u", user).setMaxResults(limit).getResultList();
    }

    public List<AssessmentResult> levelResults(UUID user) {
        return em.createQuery("select a from AssessmentResult a where a.userId = :u and a.kind = 'LEVEL'", AssessmentResult.class)
                .setParameter("u", user).getResultList();
    }

    // ---- words and phrasal verbs

    public Optional<ItemProgress> item(UUID user, String itemId) {
        return Optional.ofNullable(em.find(ItemProgress.class, new ItemProgress.Key(user, itemId)));
    }

    public ItemProgress itemForUpdate(UUID user, String itemId, String kind, Instant now) {
        return item(user, itemId).orElseGet(() -> {
            ItemProgress p = new ItemProgress(user, itemId, kind, now);
            em.persist(p);
            return p;
        });
    }

    public Map<String, ItemProgress> items(UUID user) {
        Map<String, ItemProgress> out = new HashMap<>();
        em.createQuery("select p from ItemProgress p where p.id.userId = :u", ItemProgress.class).setParameter("u", user)
                .getResultList().forEach(p -> out.put(p.itemId(), p));
        return out;
    }

    public List<ItemProgress> due(UUID user, String kind, Instant now, int limit) {
        String filter = kind == null ? "" : " and p.kind = :k";
        var q = em.createQuery("select p from ItemProgress p where p.id.userId = :u and p.nextReviewAt <= :now" + filter + " order by p.nextReviewAt asc", ItemProgress.class)
                .setParameter("u", user).setParameter("now", now);
        if (kind != null) q.setParameter("k", kind);
        return q.setMaxResults(limit).getResultList();
    }

    public long dueCount(UUID user, Instant now) {
        return em.createQuery("select count(p) from ItemProgress p where p.id.userId = :u and p.nextReviewAt <= :now", Long.class)
                .setParameter("u", user).setParameter("now", now).getSingleResult();
    }

    public void delete(ItemProgress p) { em.remove(p); }

    /** How many items are due between two moments (from inclusive, to exclusive). Used to tell the learner what is coming up for revision. */
    public long dueBetween(UUID user, Instant from, Instant to) {
        return em.createQuery("select count(p) from ItemProgress p where p.id.userId = :u and p.nextReviewAt >= :from and p.nextReviewAt < :to", Long.class)
                .setParameter("u", user).setParameter("from", from).setParameter("to", to).getSingleResult();
    }

    // ---- daily plans

    public Optional<DailyPlan> latestPlan(UUID user) {
        return em.createQuery("select d from DailyPlan d where d.userId = :u order by d.seq desc", DailyPlan.class).setParameter("u", user).setMaxResults(1)
                .getResultStream().findFirst();
    }

    public List<DailyPlan> plans(UUID user) {
        return em.createQuery("select d from DailyPlan d where d.userId = :u order by d.seq", DailyPlan.class).setParameter("u", user).getResultList();
    }

    public long plansOn(UUID user, LocalDate day) {
        return em.createQuery("select count(d) from DailyPlan d where d.userId = :u and d.planDate = :day", Long.class).setParameter("u", user).setParameter("day", day)
                .getSingleResult();
    }

    public void save(DailyPlan plan) { em.persist(plan); }

    // ---- topics and days

    public Map<String, TopicStat> topicStats(UUID user) {
        Map<String, TopicStat> out = new HashMap<>();
        em.createQuery("select t from TopicStat t where t.id.userId = :u", TopicStat.class).setParameter("u", user)
                .getResultList().forEach(t -> out.put(t.lessonId(), t));
        return out;
    }

    public TopicStat topicStatForUpdate(UUID user, String lessonId, Instant now) {
        TopicStat t = em.find(TopicStat.class, new TopicStat.Key(user, lessonId));
        if (t == null) {
            t = new TopicStat(user, lessonId, now);
            em.persist(t);
        }
        return t;
    }

    public void touchDay(UUID user, LocalDate day) {
        LearningDay d = em.find(LearningDay.class, new LearningDay.Key(user, day));
        if (d == null) {
            d = new LearningDay(user, day);
            em.persist(d);
        }
        d.touch();
    }

    public List<LocalDate> days(UUID user, LocalDate since) {
        return em.createQuery("select d.id.day from LearningDay d where d.id.userId = :u and d.id.day >= :since order by d.id.day desc", LocalDate.class)
                .setParameter("u", user).setParameter("since", since).getResultList();
    }
}
