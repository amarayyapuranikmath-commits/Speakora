package com.englishspeaking.platform.calling;

import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;

/**
 * Minimal TURN client (RFC 5766 over UDP) that performs a real authenticated Allocate and then releases it.
 * Lets an administrator confirm that a configured TURN server accepts the credentials this backend issues,
 * without needing a browser or a second device. Only {@code turn:} over UDP is probed.
 */
@Component
public class TurnProbe {
    public record Result(boolean ok, String message, String relayAddress) {
        static Result fail(String message) { return new Result(false, message, null); }
    }

    private static final int MAGIC_COOKIE = 0x2112A442;
    private static final int ALLOCATE = 0x0003, ALLOCATE_OK = 0x0103, ALLOCATE_ERR = 0x0113, REFRESH = 0x0004;
    private static final int USERNAME = 0x0006, INTEGRITY = 0x0008, ERROR_CODE = 0x0009, REALM = 0x0014, NONCE = 0x0015,
            REQUESTED_TRANSPORT = 0x0019, XOR_RELAYED = 0x0016, LIFETIME = 0x000D;
    private final SecureRandom random = new SecureRandom();

    public Result probe(String host, int port, String username, String password, Duration timeout) {
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setSoTimeout((int) timeout.toMillis());
            InetSocketAddress server = new InetSocketAddress(InetAddress.getByName(host), port);

            // 1. Unauthenticated Allocate: a TURN server must answer 401 with its realm and a nonce.
            byte[] first = send(socket, server, message(ALLOCATE, attr(REQUESTED_TRANSPORT, new byte[]{17, 0, 0, 0})));
            if (first == null) return Result.fail("No reply from " + host + ":" + port + " (server down, wrong port, or UDP blocked by a firewall).");
            Parsed challenge = parse(first);
            if (challenge.type != ALLOCATE_ERR || challenge.errorCode != 401 || challenge.realm == null || challenge.nonce == null) {
                return Result.fail("Server answered, but not with the expected 401 challenge (type 0x" + Integer.toHexString(challenge.type)
                        + ", error " + challenge.errorCode + "). Is this a TURN server?");
            }

            // 2. Authenticated Allocate with the time-limited credentials.
            byte[] key = md5(username + ":" + challenge.realm + ":" + password);
            byte[] second = send(socket, server, authenticated(ALLOCATE, key, username, challenge, attr(REQUESTED_TRANSPORT, new byte[]{17, 0, 0, 0})));
            if (second == null) return Result.fail("The server did not answer the authenticated request.");
            Parsed result = parse(second);
            if (result.type == ALLOCATE_OK) {
                // 3. Release the relay right away instead of leaving it allocated for ten minutes.
                byte[] lifetimeZero = attr(LIFETIME, ByteBuffer.allocate(4).putInt(0).array());
                send(socket, server, authenticated(REFRESH, key, username, challenge, lifetimeZero));
                return new Result(true, "Authenticated allocation succeeded (realm \"" + challenge.realm + "\"). The credentials are accepted and a relay address was granted.", result.relay);
            }
            if (result.errorCode == 401 || result.errorCode == 441) {
                return Result.fail("The server REJECTED the credentials (" + result.errorCode + "). The TURN provider did not accept the credentials it issued (wrong token/plan, or a server clock problem).");
            }
            if (result.errorCode == 438) return Result.fail("The nonce was rejected as stale (438). Try again.");
            return Result.fail("Allocation failed with TURN error " + result.errorCode + ".");
        } catch (SocketTimeoutException e) {
            return Result.fail("Timed out waiting for the TURN server.");
        } catch (Exception e) {
            return Result.fail("Could not run the TURN check: " + e.getClass().getSimpleName());
        }
    }

    private byte[] authenticated(int type, byte[] key, String username, Parsed challenge, byte[] extra) throws Exception {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write(extra);
        body.write(attr(USERNAME, username.getBytes(StandardCharsets.UTF_8)));
        body.write(attr(REALM, challenge.realm.getBytes(StandardCharsets.UTF_8)));
        body.write(attr(NONCE, challenge.nonceBytes));
        byte[] attrs = body.toByteArray();
        // MESSAGE-INTEGRITY covers the header (with its length already counting the 24-byte integrity attribute) and all prior attributes.
        byte[] header = header(type, attrs.length + 24);
        Mac mac = Mac.getInstance("HmacSHA1");
        mac.init(new SecretKeySpec(key, "HmacSHA1"));
        mac.update(header);
        mac.update(attrs);
        byte[] integrity = mac.doFinal();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(header);
        out.write(attrs);
        out.write(attr(INTEGRITY, integrity));
        return out.toByteArray();
    }

    private byte[] message(int type, byte[] attrs) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(header(type, attrs.length));
        out.write(attrs);
        return out.toByteArray();
    }

    private byte[] header(int type, int length) {
        byte[] txid = new byte[12];
        random.nextBytes(txid);
        return ByteBuffer.allocate(20).putShort((short) type).putShort((short) length).putInt(MAGIC_COOKIE).put(txid).array();
    }

    private static byte[] attr(int type, byte[] value) {
        int padded = (value.length + 3) & ~3;
        ByteBuffer b = ByteBuffer.allocate(4 + padded);
        b.putShort((short) type).putShort((short) value.length).put(value);
        return b.array();
    }

    private static byte[] send(DatagramSocket socket, InetSocketAddress server, byte[] data) throws Exception {
        socket.send(new DatagramPacket(data, data.length, server));
        byte[] buf = new byte[2048];
        DatagramPacket reply = new DatagramPacket(buf, buf.length);
        try {
            socket.receive(reply);
        } catch (SocketTimeoutException e) {
            return null;
        }
        byte[] out = new byte[reply.getLength()];
        System.arraycopy(buf, 0, out, 0, out.length);
        return out;
    }

    private static byte[] md5(String s) throws Exception { return MessageDigest.getInstance("MD5").digest(s.getBytes(StandardCharsets.UTF_8)); }

    private record Parsed(int type, int errorCode, String realm, String nonce, byte[] nonceBytes, String relay) {}

    private static Parsed parse(byte[] m) {
        ByteBuffer b = ByteBuffer.wrap(m);
        int type = b.getShort(0) & 0xFFFF;
        int length = Math.min(b.getShort(2) & 0xFFFF, m.length - 20);
        int error = 0;
        String realm = null, nonce = null, relay = null;
        byte[] nonceBytes = null;
        int off = 20;
        while (off + 4 <= 20 + length) {
            int t = b.getShort(off) & 0xFFFF, l = b.getShort(off + 2) & 0xFFFF;
            if (off + 4 + l > m.length) break;
            byte[] v = new byte[l];
            System.arraycopy(m, off + 4, v, 0, l);
            switch (t) {
                case ERROR_CODE -> error = l >= 4 ? (v[2] & 0x07) * 100 + (v[3] & 0xFF) : 0;
                case REALM -> realm = new String(v, StandardCharsets.UTF_8);
                case NONCE -> { nonce = new String(v, StandardCharsets.UTF_8); nonceBytes = v; }
                case XOR_RELAYED -> {
                    if (l >= 8 && v[1] == 1) {
                        int port = (((v[2] & 0xFF) << 8) | (v[3] & 0xFF)) ^ (MAGIC_COOKIE >>> 16);
                        int cookie = MAGIC_COOKIE;
                        relay = ((v[4] & 0xFF) ^ (cookie >>> 24 & 0xFF)) + "." + ((v[5] & 0xFF) ^ (cookie >>> 16 & 0xFF)) + "."
                                + ((v[6] & 0xFF) ^ (cookie >>> 8 & 0xFF)) + "." + ((v[7] & 0xFF) ^ (cookie & 0xFF)) + ":" + port;
                    }
                }
                default -> { }
            }
            off += 4 + ((l + 3) & ~3);
        }
        return new Parsed(type, error, realm, nonce, nonceBytes, relay);
    }
}
