package com.englishspeaking.platform.security;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Configuration;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/** Secrets mounted as files (Docker/Kubernetes secrets) are read through Spring's "configtree" import, as application.yml configures. */
class SecretsDirectoryTest {
    @Configuration static class Empty {}

    @Test
    void aSecretFileProvidesTheValueWithoutAnyEnvironmentVariable(@TempDir Path dir) throws Exception {
        Files.writeString(dir.resolve("SECRETS_TEST_VALUE"), "sk-from-a-secret-file");
        Files.writeString(dir.resolve("DB_PASSWORD"), "pw-from-file\n"); // a trailing newline must not become part of the password

        try (ConfigurableApplicationContext ctx = new SpringApplicationBuilder(Empty.class)
                .web(WebApplicationType.NONE)
                .properties("spring.config.import=optional:configtree:" + dir.toAbsolutePath().toString().replace('\\', '/') + "/")
                .run()) {
            assertThat(ctx.getEnvironment().getProperty("SECRETS_TEST_VALUE")).isEqualTo("sk-from-a-secret-file");
            assertThat(ctx.getEnvironment().getProperty("DB_PASSWORD")).isEqualTo("pw-from-file");
            assertThat(System.getenv("SECRETS_TEST_VALUE")).isNull();
        }
    }

    @Test
    void aMissingSecretsDirectoryIsNotAnError(@TempDir Path dir) {
        try (ConfigurableApplicationContext ctx = new SpringApplicationBuilder(Empty.class)
                .web(WebApplicationType.NONE)
                .properties("spring.config.import=optional:configtree:" + dir.resolve("does-not-exist").toAbsolutePath().toString().replace('\\', '/') + "/")
                .run()) {
            assertThat(ctx.getEnvironment().getProperty("SECRETS_TEST_VALUE")).isNull();
        }
    }
}
