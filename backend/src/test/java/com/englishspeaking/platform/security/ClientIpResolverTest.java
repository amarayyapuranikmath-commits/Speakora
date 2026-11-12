package com.englishspeaking.platform.security;

import com.englishspeaking.platform.TestSupport;
import jakarta.servlet.http.HttpServletRequestWrapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ClientIpResolverTest {
    private ClientIpResolver resolver(String trusted) {
        return new ClientIpResolver(TestSupport.propsWithTurnix("t", "https://x", false, trusted));
    }

    private MockHttpServletRequest req(String peer, String... xff) {
        var r = new MockHttpServletRequest();
        r.setRemoteAddr(peer);
        for (String h : xff) r.addHeader("X-Forwarded-For", h);
        return r;
    }

    @Test
    void withoutTrustedProxiesForwardedHeadersAreIgnored() {
        assertThat(resolver("").publicIp(req("198.51.100.20", "203.0.113.9"))).contains("198.51.100.20");
    }

    @Test
    void aSpoofedHeaderFromAnUntrustedPeerCannotChooseTheIp() {
        assertThat(resolver("10.0.0.0/8").publicIp(req("198.51.100.20", "8.8.8.8"))).contains("198.51.100.20");
    }

    @Test
    void aTrustedProxyVouchesForTheClientItReports() {
        assertThat(resolver("172.18.0.0/16").publicIp(req("172.18.0.5", "203.0.113.9"))).contains("203.0.113.9");
    }

    @Test
    void theRightMostUntrustedHopWinsSoClientPrependedEntriesAreIgnored() {
        assertThat(resolver("172.18.0.0/16,10.1.1.1").publicIp(req("172.18.0.5", "1.1.1.1, 203.0.113.9, 10.1.1.1"))).contains("203.0.113.9");
    }

    @Test
    void multipleHeaderLinesAreCombined() {
        assertThat(resolver("172.18.0.5").publicIp(req("172.18.0.5", "1.1.1.1", "203.0.113.9"))).contains("203.0.113.9");
    }

    @Test
    void aMalformedHopStopsTheWalkAtTheLastVerifiedAddress() {
        assertThat(resolver("172.18.0.5").publicIp(req("172.18.0.5", "203.0.113.9, not-an-ip"))).isEmpty(); // only the private proxy is verified
        assertThat(resolver("172.18.0.5,203.0.113.50").publicIp(req("172.18.0.5", "9.9.9.9, 203.0.113.50, bogus%zone"))).isEmpty();
        assertThat(resolver("172.18.0.5,203.0.113.50").publicIp(req("172.18.0.5", "9.9.9.9, bogus, 203.0.113.50"))).contains("203.0.113.50");
    }

    @Test
    void nonPublicAddressesYieldNothingSoNoHeaderIsSent() {
        for (String ip : new String[]{"127.0.0.1", "10.2.3.4", "192.168.1.5", "172.16.0.9", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::5", "224.0.0.1", "255.255.255.255"}) {
            assertThat(resolver("").publicIp(req(ip))).as(ip).isEmpty();
        }
    }

    @Test
    void publicIpv6AndTrustedIpv4AreSupported() {
        assertThat(resolver("").publicIp(req("2001:4860:4860:0:0:0:0:8888"))).contains("2001:4860:4860:0:0:0:0:8888");
        assertThat(resolver("2001:db8::/32").publicIp(req("2001:db8::1", "203.0.113.9"))).contains("203.0.113.9");
    }

    @Test
    void headerValuesAreNeverResolvedAsHostnames() {
        assertThat(resolver("172.18.0.5").publicIp(req("172.18.0.5", "localhost"))).isEmpty();
        assertThat(resolver("172.18.0.5").publicIp(req("172.18.0.5", "2130706433"))).isEmpty();
        assertThat(resolver("172.18.0.5").publicIp(req("172.18.0.5", "203.0.113.9:4444"))).isEmpty();
    }

    @Test
    void theRealSocketPeerIsReadThroughRequestWrappers() {
        // Spring's ForwardedHeaderFilter wraps the request and may rewrite getRemoteAddr() from client headers.
        var inner = req("198.51.100.20", "8.8.8.8");
        var wrapped = new HttpServletRequestWrapper(inner) {
            @Override public String getRemoteAddr() { return "8.8.8.8"; }
        };
        assertThat(resolver("").publicIp(wrapped)).contains("198.51.100.20");
    }

    @Test
    void clientAddressIsTheVerifiedCallerInAnyRangeForKeyingLimits() {
        // Private and loopback callers are real callers for rate limiting, unlike for geo-routing.
        assertThat(resolver("").clientAddress(req("127.0.0.1"))).isEqualTo("127.0.0.1");
        assertThat(resolver("").clientAddress(req("10.2.3.4"))).isEqualTo("10.2.3.4");
        assertThat(resolver("").publicIp(req("10.2.3.4"))).isEmpty();
    }

    @Test
    void clientAddressIgnoresForwardedHeadersUnlessThePeerIsTrusted() {
        assertThat(resolver("").clientAddress(req("198.51.100.20", "8.8.8.8"))).isEqualTo("198.51.100.20");
        assertThat(resolver("172.18.0.0/16").clientAddress(req("198.51.100.20", "8.8.8.8"))).isEqualTo("198.51.100.20");
        assertThat(resolver("172.18.0.0/16").clientAddress(req("172.18.0.5", "1.2.3.4, 203.0.113.9"))).isEqualTo("203.0.113.9");
    }

    @Test
    void clientAddressIsNotChangedByAForwardedHeaderWrapper() {
        var inner = req("198.51.100.20", "8.8.8.8");
        var wrapped = new HttpServletRequestWrapper(inner) {
            @Override public String getRemoteAddr() { return "8.8.8.8"; }
        };
        assertThat(resolver("").clientAddress(wrapped)).isEqualTo("198.51.100.20");
    }

    @Test
    void aMalformedForwardedChainFallsBackToTheLastVerifiedHopNeverTheForgedOne() {
        assertThat(resolver("172.18.0.5").clientAddress(req("172.18.0.5", "203.0.113.9, nonsense"))).isEqualTo("172.18.0.5");
    }

    @Test
    void invalidTrustedProxyConfigurationFailsFast() {
        assertThatThrownBy(() -> resolver("not-an-ip")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> resolver("10.0.0.0/40")).isInstanceOf(IllegalArgumentException.class);
    }
}
