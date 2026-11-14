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

    /** KEYS: queue, entry. ARGV: userId, score, json, ttlMillis. Stores the entry and queues the person in one round trip (a re-join simply overwrites both). */
    private static final DefaultRedisScript<Long> ENQUEUE = new DefaultRedisScript<>("""
            redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4])
            redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
            return 1
            """, Long.class);

    /** KEYS: queue, entry. ARGV: userId. Returns 1 if the person was queued. */
    private static final DefaultRedisScript<Long> REMOVE = new DefaultRedisScript<>("""
            local removed = redis.call('ZREM', KEYS[1], ARGV[1])
            redis.call('DEL', KEYS[2])
            return removed
            """, Long.class);

    /**
     * KEYS: queue, my recent-partners set. ARGV: my id, candidate limit. One round trip for: am I still queued (1/0), who did I talk to recently,
     * and who is waiting (oldest first). Every key is declared.
     */
    private static final DefaultRedisScript<List> CONTEXT_1 = new DefaultRedisScript<>("""
            local queued = 0
            if redis.call('ZSCORE', KEYS[1], ARGV[1]) then queued = 1 end
            return { queued, redis.call('SMEMBERS', KEYS[2]), redis.call('ZRANGE', KEYS[1], 0, tonumber(ARGV[2]) - 1) }
            """, List.class);

    /**
     * KEYS: N entry keys, then N presence keys. ARGV: N. Returns the entries and the presence markers in the same order. A missing one comes back as
     * an empty string (not as nil inside an array, which Lua and some Redis-compatible servers convert differently).
     */
    private static final DefaultRedisScript<List> CONTEXT_2 = new DefaultRedisScript<>("""
            local n = tonumber(ARGV[1])
            local entries = redis.call('MGET', unpack(KEYS, 1, n))
            local presence = redis.call('MGET', unpack(KEYS, n + 1, 2 * n))
            for i = 1, n do
              if not entries[i] then entries[i] = '' end
              if not presence[i] then presence[i] = '' end
            end
            return { entries, presence }
            """, List.class);

    /** KEYS: two recent-partner sets. ARGV: userA, userB, ttlMillis. Remembers the pair for both people in one round trip. */
    private static final DefaultRedisScript<Long> REMEMBER_PAIR = new DefaultRedisScript<>("""
            redis.call('SADD', KEYS[1], ARGV[2])
            redis.call('PEXPIRE', KEYS[1], ARGV[3])
            redis.call('SADD', KEYS[2], ARGV[1])
            redis.call('PEXPIRE', KEYS[2], ARGV[3])
            return 1
            """, Long.class);

    /** KEYS: active markers. ARGV: callId. Clears each marker that still points at this call, all in one round trip. */
    private static final DefaultRedisScript<Long> RELEASE_ALL = new DefaultRedisScript<>("""
            local cleared = 0
            for i = 1, #KEYS do
              if redis.call('GET', KEYS[i]) == ARGV[1] then cleared = cleared + redis.call('DEL', KEYS[i]) end
            end
            return cleared
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
            redis.execute(ENQUEUE, List.of(QUEUE, entryKey(id)), id, String.valueOf(entry.enqueuedAtMillis()), mapper.writeValueAsString(entry),
                    String.valueOf(ENTRY_TTL.toMillis()));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    @Override
    public boolean remove(UUID userId) {
        String id = userId.toString();
        Long removed = redis.execute(REMOVE, List.of(QUEUE, entryKey(id)), id);
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
    @SuppressWarnings("unchecked")
    public MatchContext matchContext(UUID me, int limit) {
        // Round trip 1: am I still queued, who did I talk to recently, who is waiting.
        List<Object> first = redis.execute(CONTEXT_1, List.of(QUEUE, recentKey(me)), me.toString(), String.valueOf(limit));
        if (first == null || ((Number) first.get(0)).longValue() == 0L) return MatchContext.notQueued();
        Set<UUID> recent = new HashSet<>();
        for (Object m : (List<Object>) first.get(1)) recent.add(UUID.fromString(String.valueOf(m)));
        List<String> ids = new ArrayList<>();
        for (Object m : (List<Object>) first.get(2)) ids.add(String.valueOf(m));
        if (ids.isEmpty()) return new MatchContext(true, recent, List.of(), Set.of());
        // Round trip 2: the entries and the presence of everyone listed.
        List<String> keys = new ArrayList<>();
        for (String id : ids) keys.add(entryKey(id));
        for (String id : ids) keys.add(presenceKey(UUID.fromString(id)));
        List<Object> second = redis.execute(CONTEXT_2, keys, String.valueOf(ids.size()));
        List<Object> raw = (List<Object>) second.get(0);
        List<Object> presence = (List<Object>) second.get(1);
        List<QueueEntry> entries = new ArrayList<>();
        Set<UUID> online = new HashSet<>();
        for (int i = 0; i < ids.size(); i++) {
            String json = raw.get(i) == null || String.valueOf(raw.get(i)).isEmpty() ? null : String.valueOf(raw.get(i));
            if (json == null) {
                redis.opsForZSet().remove(QUEUE, ids.get(i)); // entry expired: drop the orphan
                continue;
            }
            try {
                QueueEntry entry = mapper.readValue(json, QueueEntry.class);
                entries.add(entry);
                if (presence.get(i) != null && !String.valueOf(presence.get(i)).isEmpty()) online.add(entry.userId());
            } catch (JsonProcessingException e) {
                log.warn("Dropping unreadable queue entry for {}", ids.get(i));
                redis.opsForZSet().remove(QUEUE, ids.get(i));
            }
        }
        return new MatchContext(true, recent, entries, online);
    }

    @Override
    public Set<UUID> online(Collection<UUID> users) {
        if (users.isEmpty()) return Set.of();
        List<UUID> list = new ArrayList<>(users);
        List<String> values = redis.opsForValue().multiGet(list.stream().map(RedisMatchmakingStore::presenceKey).toList());
        Set<UUID> out = new HashSet<>();
        for (int i = 0; i < list.size(); i++) if (values != null && values.get(i) != null) out.add(list.get(i));
        return out;
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
            redis.delete(List.of(entryKey(a.toString()), entryKey(b.toString())));
            return true;
        }
        return false;
    }

    @Override
    public void releaseCall(UUID callId, Collection<UUID> users) {
        if (users.isEmpty()) return;
        // One round trip for everyone; each marker is still cleared only if it still points at this call.
        redis.execute(RELEASE_ALL, users.stream().map(RedisMatchmakingStore::activeKey).toList(), callId.toString());
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
        redis.execute(REMEMBER_PAIR, List.of(recentKey(a), recentKey(b)), a.toString(), b.toString(), String.valueOf(RECENT_TTL.toMillis()));
    }

    private static String entryKey(String id) { return "mm:entry:" + id; }
    private static String activeKey(UUID id) { return "mm:active:" + id; }
    private static String presenceKey(UUID id) { return "mm:presence:" + id; }
    private static String recentKey(UUID id) { return "mm:recent:" + id; }
}
