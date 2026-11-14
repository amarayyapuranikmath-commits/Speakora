package com.englishspeaking.platform.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {
    @Query("select u from User u where lower(u.email) = lower(:email)")
    Optional<User> findByEmail(@Param("email") String email);

    @Query("select count(u) > 0 from User u where lower(u.email) = lower(:email)")
    boolean existsByEmail(@Param("email") String email);

    /** Moderator search: matches email or display name, optionally limited to one status. */
    @Query("""
            select u from User u left join UserProfile p on p.userId = u.id
            where (:status is null or u.status = :status)
              and (:q is null or lower(u.email) like lower(concat('%', :q, '%')) or lower(p.displayName) like lower(concat('%', :q, '%')))
            order by u.createdAt desc
            """)
    org.springframework.data.domain.Page<User> search(@Param("q") String q, @Param("status") UserStatus status,
                                                      org.springframework.data.domain.Pageable pageable);

    boolean existsByRole(String role);

    /**
     * The account, its profile and its preferences in one query (three round trips to a remote database before). Empty when any of the three is
     * missing; callers then take the step-by-step path, which reports exactly which one.
     */
    @Query("select u, p, pr from User u, com.englishspeaking.platform.profile.UserProfile p, com.englishspeaking.platform.preferences.UserPreferences pr "
            + "where u.id = :id and p.userId = u.id and pr.userId = u.id")
    java.util.List<Object[]> findAccountProfileAndPreferences(@Param("id") UUID id);

    java.util.List<User> findByEmailInAndEmailVerifiedTrue(java.util.Collection<String> emails);
}
