package com.englishspeaking.platform;

import com.englishspeaking.platform.security.AppProperties;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

public final class TestSupport {
    public static final String SECRET = "test-secret-test-secret-test-secret-123456";

    private TestSupport() {}

    public static AppProperties props() {
        return new AppProperties("Test App", "http://localhost:5173", "http://localhost:5173",
                new AppProperties.Jwt(SECRET, 15), 30, false, new AppProperties.Turn());
    }

    public static AppProperties propsWithTurnix(String token, String apiUrl, boolean forceRelay, String trustedProxies) {
        return new AppProperties("Test App", "http://localhost:5173", "http://localhost:5173",
                new AppProperties.Jwt(SECRET, 15), 30, false, new AppProperties.Turn(token, apiUrl, forceRelay, trustedProxies));
    }

    /** Clock tests can move forward deterministically. */
    public static final class MutableClock extends Clock {
        private volatile Instant now;

        public MutableClock(Instant start) { this.now = start; }

        public void advance(Duration d) { now = now.plus(d); }

        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) {
            MutableClock self = this;
            return new Clock() {
                @Override public ZoneId getZone() { return zone; }
                @Override public Clock withZone(ZoneId z) { return self.withZone(z); }
                @Override public Instant instant() { return self.instant(); }
            };
        }
        @Override public Instant instant() { return now; }
    }
}
