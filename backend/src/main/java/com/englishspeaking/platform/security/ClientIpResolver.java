package com.englishspeaking.platform.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Works out the real address of the end user without believing arbitrary headers. This is the single place the application
 * learns "who is calling": the rate limiter keys on {@link #clientAddress} and the TURN request uses {@link #publicIp}.
 *
 * <p>The only address that cannot be forged is the TCP peer. It is read from the innermost servlet request, so even if a
 * forwarded-header filter were ever enabled again (Spring's {@code ForwardedHeaderFilter} lets {@code getRemoteAddr()} follow
 * headers a client sent) it could not change the answer. X-Forwarded-For is consulted only when that peer is listed in
 * {@code TRUSTED_PROXIES}; then the right-most entry that is not itself a trusted proxy is the client. With no trusted proxy
 * configured, headers are ignored entirely. {@link #publicIp} additionally drops private, loopback, link-local, CGNAT and
 * unique-local addresses (useless for geo-routing), so no header is sent upstream for them.
 */
@Component
public class ClientIpResolver {
    private static final Pattern IP_CHARS = Pattern.compile("[0-9a-fA-F:.]{2,45}");
    private final List<Cidr> trusted;

    public ClientIpResolver(AppProperties props) {
        this.trusted = parse(props.turn() == null ? null : props.turn().trustedProxies());
    }

    /**
     * The verified address of the caller in any range (private and loopback included), as a stable string for keying limits.
     * Never null: an unparseable peer address (should not happen) is returned as-is rather than letting callers share a bucket.
     */
    public String clientAddress(HttpServletRequest request) {
        InetAddress client = verifiedClient(request);
        return client != null ? client.getHostAddress() : String.valueOf(rawRequest(request).getRemoteAddr());
    }

    /** The caller's address only if it is public, otherwise empty. */
    public Optional<String> publicIp(HttpServletRequest request) {
        InetAddress client = verifiedClient(request);
        return client != null && isPublic(client) ? Optional.of(client.getHostAddress()) : Optional.empty();
    }

    private static HttpServletRequest rawRequest(HttpServletRequest request) {
        HttpServletRequest raw = request;
        while (raw instanceof HttpServletRequestWrapper w && w.getRequest() instanceof HttpServletRequest inner) raw = inner;
        return raw;
    }

    private InetAddress verifiedClient(HttpServletRequest request) {
        HttpServletRequest raw = rawRequest(request);
        InetAddress client = literal(raw.getRemoteAddr());
        if (client == null) return null;
        if (isTrusted(client)) {
            List<String> hops = new ArrayList<>();
            var headers = raw.getHeaders("X-Forwarded-For");
            while (headers != null && headers.hasMoreElements()) {
                for (String part : headers.nextElement().split(",")) hops.add(part.trim());
            }
            for (int i = hops.size() - 1; i >= 0; i--) {
                InetAddress hop = literal(hops.get(i));
                if (hop == null) break; // malformed entry: stop and keep the last address we could verify
                client = hop;
                if (!isTrusted(hop)) break;
            }
        }
        return client;
    }

    private boolean isTrusted(InetAddress a) { return trusted.stream().anyMatch(c -> c.contains(a)); }

    /** Parses an IP literal only; never performs a DNS lookup. */
    static InetAddress literal(String s) {
        if (s == null || !IP_CHARS.matcher(s).matches() || !(s.contains(".") || s.contains(":"))) return null;
        if (!s.contains(":") && !s.matches("(\\d{1,3}\\.){3}\\d{1,3}")) return null;
        try {
            return InetAddress.getByName(s);
        } catch (UnknownHostException e) {
            return null;
        }
    }

    static boolean isPublic(InetAddress a) {
        if (a.isAnyLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress() || a.isSiteLocalAddress() || a.isMulticastAddress()) return false;
        byte[] b = a.getAddress();
        if (b.length == 4) {
            int b0 = b[0] & 0xff, b1 = b[1] & 0xff;
            if (b0 == 0) return false;                              // 0.0.0.0/8
            if (b0 == 100 && b1 >= 64 && b1 <= 127) return false;   // CGNAT 100.64.0.0/10
            return b0 < 240;                                        // reserved / broadcast
        }
        return (b[0] & 0xfe) != 0xfc;                               // unique local fc00::/7
    }

    private static List<Cidr> parse(String csv) {
        List<Cidr> out = new ArrayList<>();
        if (csv == null) return out;
        for (String raw : csv.split(",")) {
            String s = raw.trim();
            if (s.isEmpty()) continue;
            String[] parts = s.split("/", 2);
            InetAddress base = literal(parts[0]);
            if (base == null) throw new IllegalArgumentException("TRUSTED_PROXIES contains an invalid address: " + s);
            int bits = base.getAddress().length * 8;
            int prefix = parts.length == 2 ? Integer.parseInt(parts[1]) : bits;
            if (prefix < 0 || prefix > bits) throw new IllegalArgumentException("TRUSTED_PROXIES contains an invalid prefix: " + s);
            out.add(new Cidr(base.getAddress(), prefix));
        }
        return out;
    }

    private record Cidr(byte[] base, int prefix) {
        boolean contains(InetAddress a) {
            byte[] x = a.getAddress();
            if (x.length != base.length) return false;
            int full = prefix / 8, rest = prefix % 8;
            for (int i = 0; i < full; i++) if (x[i] != base[i]) return false;
            if (rest == 0) return true;
            int mask = 0xff << (8 - rest) & 0xff;
            return (x[full] & mask) == (base[full] & mask);
        }
    }
}
