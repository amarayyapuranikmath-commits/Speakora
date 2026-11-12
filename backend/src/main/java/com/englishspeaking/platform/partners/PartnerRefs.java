package com.englishspeaking.platform.partners;

import com.englishspeaking.platform.security.AppProperties;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.UUID;

/**
 * An opaque, per-viewer handle for a previous partner. It lets a client ask to reconnect without ever being given the other
 * person's user id: the handle is only meaningful for this viewer (an HMAC over viewer and partner) and cannot be guessed.
 */
@Component
public class PartnerRefs {
    private final byte[] key;

    public PartnerRefs(AppProperties props) { this.key = props.jwt().secret().getBytes(StandardCharsets.UTF_8); }

    /** Handle for a previous partner (someone met in a random call). */
    public String refFor(UUID viewer, UUID partner) { return ref("partner", viewer, partner); }

    /** Handle for a friend. A different domain from {@link #refFor}, so one kind of handle can never be used as the other. */
    public String friendRef(UUID viewer, UUID friend) { return ref("friend", viewer, friend); }

    public boolean matchesFriend(UUID viewer, UUID friend, String ref) { return matches(friendRef(viewer, friend), ref); }

    private String ref(String domain, UUID viewer, UUID partner) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            byte[] digest = mac.doFinal((domain + "|" + viewer + "|" + partner).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOf(digest, 16));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public boolean matches(UUID viewer, UUID partner, String ref) { return matches(refFor(viewer, partner), ref); }

    private static boolean matches(String expected, String given) {
        return given != null && MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), given.getBytes(StandardCharsets.UTF_8));
    }
}
