package com.englishspeaking.platform.user;

import com.englishspeaking.platform.security.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Promotes addresses listed in ADMIN_EMAILS to ADMIN, but only once the address is verified, so nobody can claim an
 * admin address just by registering with it first.
 */
@Component
public class AdminBootstrap implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final UserRepository users;
    private final AppProperties props;

    public AdminBootstrap(UserRepository users, AppProperties props) {
        this.users = users;
        this.props = props;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        List<String> emails = props.adminEmailList();
        if (emails.isEmpty()) return;
        users.findByEmailInAndEmailVerifiedTrue(emails).stream().filter(u -> !u.isAdmin()).forEach(u -> {
            u.setRole("ADMIN");
            log.info("Promoted verified user {} to ADMIN (listed in ADMIN_EMAILS)", u.getId());
        });
    }

    /** Called right after an email is verified. */
    public void promoteIfListed(User user) {
        if (user.isEmailVerified() && !user.isAdmin() && props.adminEmailList().contains(user.getEmail().toLowerCase())) {
            user.setRole("ADMIN");
            log.info("Promoted verified user {} to ADMIN (listed in ADMIN_EMAILS)", user.getId());
        }
    }
}
