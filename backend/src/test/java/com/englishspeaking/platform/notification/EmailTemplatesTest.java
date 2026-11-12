package com.englishspeaking.platform.notification;

import com.englishspeaking.platform.notification.EmailTemplates.Email;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class EmailTemplatesTest {
    private static final String APP = "Speakora";

    private List<Email> all() {
        return List.of(
                EmailTemplates.verification(APP, "482913", "https://speak.example/verify-email?token=abc", 30, 24),
                EmailTemplates.passwordReset(APP, "190377", "https://speak.example/reset-password?token=def", 30, 60),
                EmailTemplates.reminder(APP, "Ana", "https://speak.example/app/talk", "https://speak.example/app/settings"));
    }

    @Test
    void everyMessageHasASubjectAnHtmlBodyAndAPlainTextFallbackThatNameTheApplication() {
        for (Email e : all()) {
            assertThat(e.subject()).isNotBlank();
            assertThat(e.html()).startsWith("<!DOCTYPE html>").contains(APP);
            assertThat(e.text()).startsWith(APP).contains("automated message");
            assertThat(e.text()).doesNotContain("<").doesNotContain("&amp;"); // the fallback is plain text, not markup
        }
    }

    @Test
    void everyMessageIsResponsiveAndUsesTheSameBrandColour() {
        for (Email e : all()) {
            assertThat(e.html()).contains("name=\"viewport\"").contains("@media only screen and (max-width:480px)").contains("max-width:560px").contains(EmailTemplates.ACCENT);
        }
    }

    @Test
    void theCodeIsShownProminentlyAndTheExpiryIsStated() {
        Email v = all().get(0);
        assertThat(v.html()).contains("font-size:34px").contains(">482913<").contains("30 minutes").contains("24 hours").contains("Keep this private").contains("Never share this code with anyone");
        assertThat(v.text()).contains("YOUR CODE: 482913").contains("30 minutes").contains("KEEP THIS PRIVATE");
        Email r = all().get(1);
        assertThat(r.html()).contains(">190377<").contains("30 minutes").contains("60 minutes");
    }

    @Test
    void theSubjectNeverContainsTheCode() {
        assertThat(all().get(0).subject()).doesNotContain("482913");
        assertThat(all().get(1).subject()).doesNotContain("190377");
    }

    @Test
    void valuesFromOutsideAreEscapedSoAnameCannotInjectMarkup() {
        Email e = EmailTemplates.reminder(APP, "<script>alert(1)</script>\"&", "https://speak.example/a?b=1&c=\"2\"", "https://speak.example/s");
        assertThat(e.html()).doesNotContain("<script>").contains("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;");
        assertThat(e.html()).contains("href=\"https://speak.example/a?b=1&amp;c=&quot;2&quot;\"");
    }

    @Test
    void anApplicationNameWithMarkupCharactersIsEscapedToo() {
        Email e = EmailTemplates.verification("A & B <Speak>", "123456", "https://x/y", 30, 24);
        assertThat(e.html()).doesNotContain("<Speak>").contains("A &amp; B &lt;Speak&gt;");
        assertThat(e.subject()).isEqualTo("Verify your email for A & B <Speak>"); // the subject is a header, not HTML
    }

    /** Not a check: with -DemailPreview=&lt;folder&gt; it writes each message as an .html file so the design can be looked at in a browser. */
    @Test
    void writesPreviewFilesWhenAskedTo() throws Exception {
        String dir = System.getProperty("emailPreview");
        org.junit.jupiter.api.Assumptions.assumeTrue(dir != null && !dir.isBlank());
        java.nio.file.Files.createDirectories(java.nio.file.Path.of(dir));
        String[] names = {"verification", "password-reset", "reminder"};
        for (int i = 0; i < names.length; i++) {
            java.nio.file.Files.writeString(java.nio.file.Path.of(dir, names[i] + ".html"), all().get(i).html());
            java.nio.file.Files.writeString(java.nio.file.Path.of(dir, names[i] + ".txt"), all().get(i).text());
        }
    }

    @Test
    void thereIsNoHiddenTextAndTheLinkIsOptional() {
        for (Email e : all()) assertThat(e.html()).doesNotContain("display:none").doesNotContain("opacity:0");
        Email noLink = EmailTemplates.verification(APP, "482913", null, 30, 24);
        assertThat(noLink.html()).contains(">482913<").doesNotContain("href=").doesNotContain("Verify my email");
        assertThat(noLink.text()).contains("YOUR CODE: 482913").doesNotContain("http");
        Email resetNoLink = EmailTemplates.passwordReset(APP, "190377", null, 30, 60);
        assertThat(resetNoLink.text()).contains("YOUR CODE: 190377").doesNotContain("http");
    }

    @Test
    void thereIsNoRemoteImageOrTrackingPixelAndNoMarketing() {
        for (Email e : all()) {
            assertThat(e.html()).doesNotContain("<img").doesNotContain("<script").doesNotContain("http://").doesNotContainIgnoringCase("unsubscribe from all");
        }
    }
}
