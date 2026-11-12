package com.englishspeaking.platform.calling;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests the probe against a small stand-in TURN responder that independently verifies MESSAGE-INTEGRITY the way RFC 5766 says.
 * (A real server, node-turn, is exercised separately in the live test; real coturn needs your server.)
 */
class TurnProbeTest {
    private static final String REALM = "test-realm";
    private DatagramSocket server;
    private Thread thread;
    private volatile boolean respond = true;
    private volatile boolean sendGarbage = false;
    private volatile int refreshes = 0;
    private final String user = "1999999999:someone";
    private final String password = "pw-from-hmac";

    @BeforeEach
    void start() throws Exception {
        server = new DatagramSocket(0, InetAddress.getLoopbackAddress());
        thread = new Thread(this::serve, "fake-turn");
        thread.setDaemon(true);
        thread.start();
    }

    @AfterEach
    void stop() { server.close(); }

    private int port() { return server.getLocalPort(); }

    @Test
    void successfulAuthenticatedAllocationIsReportedAndTheRelayIsReleased() {
        var r = new TurnProbe().probe("127.0.0.1", port(), user, password, Duration.ofSeconds(2));
        assertThat(r.ok()).as(r.message()).isTrue();
        assertThat(r.relayAddress()).isEqualTo("127.0.0.1:50000");
        assertThat(refreshes).as("allocation is released with a zero-lifetime Refresh").isEqualTo(1);
    }

    @Test
    void wrongCredentialsAreReportedAsRejected() {
        var r = new TurnProbe().probe("127.0.0.1", port(), user, "wrong-password", Duration.ofSeconds(2));
        assertThat(r.ok()).isFalse();
        assertThat(r.message()).contains("REJECTED").contains("did not accept");
        assertThat(r.relayAddress()).isNull();
    }

    @Test
    void aSilentServerIsATimeoutNotAHang() {
        respond = false;
        long t0 = System.currentTimeMillis();
        var r = new TurnProbe().probe("127.0.0.1", port(), user, password, Duration.ofMillis(400));
        assertThat(r.ok()).isFalse();
        assertThat(r.message()).contains("No reply");
        assertThat(System.currentTimeMillis() - t0).isLessThan(3000);
    }

    @Test
    void somethingThatIsNotATurnServerIsRecognisedAsSuch() {
        sendGarbage = true;
        var r = new TurnProbe().probe("127.0.0.1", port(), user, password, Duration.ofSeconds(1));
        assertThat(r.ok()).isFalse();
        assertThat(r.message()).contains("Is this a TURN server");
    }

    /* ---------------- stand-in server ---------------- */

    private void serve() {
        byte[] buf = new byte[2048];
        while (!server.isClosed()) {
            try {
                DatagramPacket in = new DatagramPacket(buf, buf.length);
                server.receive(in);
                if (!respond) continue;
                byte[] msg = Arrays.copyOf(buf, in.getLength());
                byte[] reply = sendGarbage ? new byte[]{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20} : handle(msg);
                server.send(new DatagramPacket(reply, reply.length, in.getAddress(), in.getPort()));
            } catch (Exception e) {
                return;
            }
        }
    }

    private byte[] handle(byte[] m) throws Exception {
        ByteBuffer b = ByteBuffer.wrap(m);
        int type = b.getShort(0) & 0xFFFF;
        byte[] txid = Arrays.copyOfRange(m, 8, 20);
        boolean hasIntegrity = false;
        int integrityOffset = -1;
        byte[] integrity = null;
        int off = 20;
        while (off + 4 <= m.length) {
            int t = b.getShort(off) & 0xFFFF, l = b.getShort(off + 2) & 0xFFFF;
            if (t == 0x0008) { hasIntegrity = true; integrityOffset = off; integrity = Arrays.copyOfRange(m, off + 4, off + 4 + l); }
            off += 4 + ((l + 3) & ~3);
        }
        int success = type == 0x0004 ? 0x0104 : 0x0103, error = type == 0x0004 ? 0x0114 : 0x0113;
        if (!hasIntegrity) return response(error, txid, errorCode(401, "Unauthorized"), attr(0x0014, REALM.getBytes()), attr(0x0015, "nonce-1234".getBytes()));
        // verify exactly as the RFC describes: HMAC-SHA1(MD5(user:realm:pass)) over the message up to the integrity attribute
        byte[] key = MessageDigest.getInstance("MD5").digest((user + ":" + REALM + ":" + password).getBytes(StandardCharsets.UTF_8));
        Mac mac = Mac.getInstance("HmacSHA1");
        mac.init(new SecretKeySpec(key, "HmacSHA1"));
        byte[] expected = mac.doFinal(Arrays.copyOf(m, integrityOffset));
        if (!Arrays.equals(expected, integrity)) return response(error, txid, errorCode(401, "Unauthorized"), attr(0x0014, REALM.getBytes()), attr(0x0015, "nonce-1234".getBytes()));
        if (type == 0x0004) { refreshes++; return response(success, txid); }
        // XOR-RELAYED-ADDRESS = 127.0.0.1:50000
        int cookie = 0x2112A442;
        byte[] v = new byte[8];
        v[1] = 1;
        int port = 50000 ^ (cookie >>> 16);
        v[2] = (byte) (port >> 8); v[3] = (byte) port;
        byte[] ip = {127, 0, 0, 1};
        for (int i = 0; i < 4; i++) v[4 + i] = (byte) (ip[i] ^ (cookie >>> (24 - 8 * i)));
        return response(success, txid, attr(0x0016, v));
    }

    private static byte[] errorCode(int code, String reason) {
        byte[] r = reason.getBytes(StandardCharsets.UTF_8);
        byte[] v = new byte[4 + r.length];
        v[2] = (byte) (code / 100); v[3] = (byte) (code % 100);
        System.arraycopy(r, 0, v, 4, r.length);
        return attr(0x0009, v);
    }

    private static byte[] attr(int type, byte[] value) {
        ByteBuffer b = ByteBuffer.allocate(4 + ((value.length + 3) & ~3));
        b.putShort((short) type).putShort((short) value.length).put(value);
        return b.array();
    }

    private static byte[] response(int type, byte[] txid, byte[]... attrs) throws Exception {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        for (byte[] a : attrs) body.write(a);
        ByteBuffer h = ByteBuffer.allocate(20).putShort((short) type).putShort((short) body.size()).putInt(0x2112A442).put(txid);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(h.array());
        out.write(body.toByteArray());
        return out.toByteArray();
    }
}
