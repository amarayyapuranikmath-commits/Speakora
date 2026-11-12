package com.englishspeaking.platform.matching;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.*;

@Component
public class RedisMatchmakingStore implements MatchmakingStore {
    private static final Logger log = LoggerFactory.getLogger(RedisMatchmakingStore.class);

    private static final String QUEUE = "mm:queue";
    /**
     * How long a waiting person's entry lives. It must outlast the search limit (MatchmakingService.QUEUE_TIMEOUT_MILLIS, 10 minutes): with 3 minutes,
     * someone searching alone on a quiet app was silently dropped from the queue after 3 minutes (never matched, never told) while their screen
     * still said "searching". People who have gone away are removed by the 35 second presence check, not by this.
     */
    static final Duration ENTRY_TTL = Duration.ofMinutes(11);
    private static final Duration ACTIVE_TTL = Duration.ofHours(4);
    private static final Duration PRESENCE_TTL = Duration.ofSeconds(35);
    private static final Duration RECENT_TTL = Duration.ofMinutes(10);

    /** KEYS: queue, activeA, activeB. ARGV: userA, userB, callId, ttlSeconds. */
    private static final DefaultRedisScript<Long> CLAIM = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
            if not redis.call('ZSCORE', KEYS[1], ARGV[1]) or not redis.call('ZSCORE', KEYS[1], ARGV[2]) then return 0 end
            redis.call('ZREM', KEYS[1], ARGV[1], ARGV[2])
            redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
            redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])
            return 1
            """, Long.class);

    /** KEYS: queue, activeA, activeB. ARGV: userA, userB, callId, ttlSeconds. Like CLAIM but the users need not be queued. */
    private static final DefaultRedisScript<Long> CLAIM_DIRECT = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
            redis.call('ZREM', KEYS[1], ARGV[1], ARGV[2])
            redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
            redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])
            return 1
            """, Long.class);

    /** KEYS: active key. ARGV: callId. */
    private static final DefaultRedisScript<Long> RELEASE = new DefaultRedisScript<>("""
            if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
            return 0
            """, Long.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    public RedisMatchmakingStore(StringRedisTemplate redis, ObjectMapper mapper) {
        this.redis = redis;
        this.mapper = mapper;
    }

    @Override
    public void enqueue(QueueEntry entry) {
        String id = entry.userId().toString();
        try {
            redis.opsForValue().set(entryKey(id), mapper.writeValueAsString(entry), ENTRY_TTL);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
        redis.opsForZSet().add(QUEUE, id, entry.enqueuedAtMillis());
    }

    @Override
    public boolean remove(UUID userId) {
        String id = userId.toString();
        Long removed = redis.opsForZSet().remove(QUEUE, id);
        redis.delete(entryKey(id));
        return removed != null && removed > 0;
    }

    @Override
    public boolean contains(UUID userId) { return redis.opsForZSet().score(QUEUE, userId.toString()) != null; }

    @Override
    public List<QueueEntry> candidates(int limit) {
        Set<String> ids = redis.opsForZSet().range(QUEUE, 0, limit - 1L);
        if (ids == null || ids.isEmpty()) return List.of();
        List<String> idList = new ArrayList<>(ids);
        List<String> raw = redis.opsForValue().multiGet(idList.stream().map(RedisMatchmakingStore::entryKey).toList());
        List<QueueEntry> entries = new ArrayList<>();
        for (int i = 0; i < idList.size(); i++) {
            String json = raw == null ? null : raw.get(i);
            if (json == null) {
                redis.opsForZSet().remove(QUEUE, idList.get(i)); // entry expired: drop the orphan
                continue;
            }
            try {
                entries.add(mapper.readValue(json, QueueEntry.class));
            } catch (JsonProcessingException e) {
                log.warn("Dropping unreadable queue entry for {}", idList.get(i));
                redis.opsForZSet().remove(QUEUE, idList.get(i));
            }
        }
        return entries;
    }

    @Override
    public boolean tryClaim(UUID a, UUID b, UUID callId) {
        Long result = redis.execute(CLAIM, List.of(QUEUE, activeKey(a), activeKey(b)),
                a.toString(), b.toString(), callId.toString(), String.valueOf(ACTIVE_TTL.toSeconds()));
        return result != null && result == 1L;
    }

    @Override
    public boolean claimDirect(UUID a, UUID b, UUID callId) {
        Long result = redis.execute(CLAIM_DIRECT, List.of(QUEUE, activeKey(a), activeKey(b)),
                a.toString(), b.toString(), callId.toString(), String.valueOf(ACTIVE_TTL.toSeconds()));
        if (result != null && result == 1L) {
            redis.delete(entryKey(a.toString()));
            redis.delete(entryKey(b.toString()));
            return true;
        }
        return false;
    }

    @Override
    public void releaseCall(UUID callId, Collection<UUID> users) {
        for (UUID u : users) redis.execute(RELEASE, List.of(activeKey(u)), callId.toString());
    }

    @Override
    public Optional<UUID> activeCall(UUID userId) {
        String v = redis.opsForValue().get(activeKey(userId));
        return v == null ? Optional.empty() : Optional.of(UUID.fromString(v));
    }

    @Override
    public void touchPresence(UUID userId) { redis.opsForValue().set(presenceKey(userId), "1", PRESENCE_TTL); }

    @Override
    public void clearPresence(UUID userId) { redis.delete(presenceKey(userId)); }

    @Override
    public boolean isOnline(UUID userId) { return Boolean.TRUE.equals(redis.hasKey(presenceKey(userId))); }

    @Override
    public Set<UUID> recentPartners(UUID userId) {
        Set<String> members = redis.opsForSet().members(recentKey(userId));
        if (members == null) return Set.of();
        Set<UUID> ids = new HashSet<>();
        members.forEach(m -> ids.add(UUID.fromString(m)));
        return ids;
    }

    @Override
    public void rememberPair(UUID a, UUID b) {
        redis.opsForSet().add(recentKey(a), b.toString());
        redis.expire(recentKey(a), RECENT_TTL);
        redis.opsForSet().add(recentKey(b), a.toString());
        redis.expire(recentKey(b), RECENT_TTL);
    }

    private static String entryKey(String id) { return "mm:entry:" + id; }
    private static String activeKey(UUID id) { return "mm:active:" + id; }
    private static String presenceKey(UUID id) { return "mm:presence:" + id; }
    private static String recentKey(UUID id) { return "mm:recent:" + id; }
}
