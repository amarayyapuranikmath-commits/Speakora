package com.englishspeaking.platform;

import org.junit.jupiter.api.Assumptions;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** A real Redis for tests, from ../.env, in its own database number so nothing else is touched. Skips the test when Redis is not reachable. */
public final class LocalRedis {
    public static final int DATABASE = 9;

    private LocalRedis() {}

    private static String env(String text, String key, String fallback) {
        Matcher m = Pattern.compile("(?m)^" + key + "=([^\\r\\n]*)$").matcher(text);
        return m.find() ? m.group(1).trim() : fallback;
    }

    public static StringRedisTemplate template() {
        String text;
        try { text = Files.readString(Path.of("../.env")); } catch (Exception e) { text = ""; }
        RedisStandaloneConfiguration cfg = new RedisStandaloneConfiguration(env(text, "REDIS_HOST", "localhost"), Integer.parseInt(env(text, "REDIS_PORT", "6379")));
        cfg.setDatabase(DATABASE);
        String password = env(text, "REDIS_PASSWORD", "");
        if (!password.isEmpty()) cfg.setPassword(password);
        LettuceConnectionFactory factory = new LettuceConnectionFactory(cfg);
        factory.afterPropertiesSet();
        StringRedisTemplate redis = new StringRedisTemplate(factory);
        redis.afterPropertiesSet();
        try {
            redis.opsForValue().set("test:ping", "1");
        } catch (Exception e) {
            Assumptions.abort("Redis is not reachable for tests: " + e.getClass().getSimpleName());
        }
        redis.execute((org.springframework.data.redis.core.RedisCallback<Object>) c -> { c.serverCommands().flushDb(); return null; });
        return redis;
    }
}
