package com.englishspeaking.platform.friends;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class FriendshipKeyTest {
    @Test
    void orderIsUnsignedLikePostgresAndSymmetric() {
        // Signed comparison would put the "negative" high bit first; PostgreSQL orders uuid bytes unsigned, so 0x80.. is the larger one.
        UUID small = UUID.fromString("10000000-0000-0000-0000-000000000000");
        UUID large = UUID.fromString("80000000-0000-0000-0000-000000000000");
        assertThat(large.compareTo(small)).as("java signed order disagrees with the database").isLessThan(0);

        assertThat(Friendship.Key.of(small, large).userA()).isEqualTo(small);
        assertThat(Friendship.Key.of(large, small)).isEqualTo(Friendship.Key.of(small, large));
        assertThat(Friendship.Key.of(small, large).other(small)).isEqualTo(large);
        assertThat(Friendship.Key.of(small, large).other(large)).isEqualTo(small);
    }
}
