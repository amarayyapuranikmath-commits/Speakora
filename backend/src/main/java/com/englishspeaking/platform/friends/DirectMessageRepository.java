package com.englishspeaking.platform.friends;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface DirectMessageRepository extends JpaRepository<DirectMessage, UUID> {
    @Query("select m from DirectMessage m where m.userA = :a and m.userB = :b and m.createdAt > :after order by m.createdAt desc")
    List<DirectMessage> latest(@Param("a") UUID a, @Param("b") UUID b, @Param("after") Instant after, Pageable page);

    @Query("select m from DirectMessage m where m.userA = :a and m.userB = :b and m.createdAt > :after and m.createdAt < :before order by m.createdAt desc")
    List<DirectMessage> older(@Param("a") UUID a, @Param("b") UUID b, @Param("after") Instant after, @Param("before") Instant before, Pageable page);

    @Query("select count(m) from DirectMessage m where m.userA = :a and m.userB = :b and m.senderId = :sender and m.createdAt > :after")
    long countFrom(@Param("a") UUID a, @Param("b") UUID b, @Param("sender") UUID sender, @Param("after") Instant after);

    @Query("select max(m.createdAt) from DirectMessage m where m.userA = :a and m.userB = :b and m.createdAt > :after")
    Instant lastAt(@Param("a") UUID a, @Param("b") UUID b, @Param("after") Instant after);

    /**
     * For every friend of {@code me}: the number of unread messages from them and the time of the newest visible message, in one query.
     * Columns: other person's id, unread count, newest message time (null when none). The per-pair cut-offs are the same ones the
     * friends list used to compute in code: visible messages are those after the later of "friends since" and "cleared by me";
     * unread ones are those from the friend after the later of that and "last read". The two subselects are range scans on
     * idx_dm_pair, so a long conversation costs no more than it did when each friend was queried on its own.
     */
    @Query(nativeQuery = true, value = """
            select p.other_id,
                   (select count(*) from direct_messages m
                     where m.user_a = p.user_a and m.user_b = p.user_b and m.sender_id = p.other_id and m.created_at > p.unread_after),
                   (select max(m.created_at) from direct_messages m
                     where m.user_a = p.user_a and m.user_b = p.user_b and m.created_at > p.visible_after)
              from (select f.user_a, f.user_b,
                           case when f.user_a = :me then f.user_b else f.user_a end as other_id,
                           greatest(f.created_at, coalesce(cs.cleared_at, cast('1970-01-01' as timestamptz))) as visible_after,
                           greatest(f.created_at, coalesce(cs.cleared_at, cast('1970-01-01' as timestamptz)),
                                    coalesce(cs.last_read_at, cast('1970-01-01' as timestamptz))) as unread_after
                      from friendships f
                      left join conversation_state cs
                        on cs.user_id = :me and cs.other_id = case when f.user_a = :me then f.user_b else f.user_a end
                     where f.user_a = :me or f.user_b = :me) p
            """)
    List<Object[]> activityWithFriends(@Param("me") UUID me);

    @Modifying
    @Query("delete from DirectMessage m where m.userA = :a and m.userB = :b")
    int deletePair(@Param("a") UUID a, @Param("b") UUID b);

    @Modifying
    @Query("""
            delete from DirectMessage m where m.createdAt < :before
              and not exists (select 1 from Friendship f where f.id.userA = m.userA and f.id.userB = m.userB)
            """)
    int deleteOrphansBefore(@Param("before") Instant before);

    @Modifying
    @Query("delete from DirectMessage m where m.userA = :u or m.userB = :u")
    int deleteAllFor(@Param("u") UUID u);
}
