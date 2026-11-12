package com.englishspeaking.platform.notification;

/**
 * The application's transactional emails: one shared, responsive layout and a plain-text twin of every message.
 *
 * <p>Branding is only what the product really has: its name (APP_NAME) and its colour. There is no logo image because an email cannot
 * show an image that is not hosted at a public address, and nothing here claims anything about the product beyond what the message
 * needs to say. Layout is a table with inline styles (the only thing every mail client renders) plus one media query for phones.
 * Every value that comes from outside is HTML-escaped.
 */
public final class EmailTemplates {
    /** The brand colour used by the website and the app. */
    /** The brand colours: deep navy for the header, vivid blue for the code, the button and links. */
    static final String NAVY = "#0B1F4B";
    static final String ACCENT = "#1d4ed8";

    private EmailTemplates() {}

    /** One rendered message: subject, HTML body and the plain-text fallback. */
    public record Email(String subject, String html, String text) {}

    public static Email verification(String app, String code, String link, int codeMinutes, int linkHours) {
        String subject = "Verify your email for " + app;
        Body b = new Body()
                .heading("Verify your email")
                .para("Welcome to " + app + ". Enter this code in the app to confirm your email address.")
                .code(code)
                .note("The code expires in " + codeMinutes + " minutes and can be used once.");
        if (link != null) {
            b.button("Verify my email", link)
                    .note("Or open the link above on the device where you use " + app + ". It expires in " + hours(linkHours) + ".");
        }
        b.security("Never share this code with anyone, not even someone who says they work for " + app + ". If you did not create an account, ignore this email and nothing will happen.");
        return render(app, subject, b);
    }

    public static Email passwordReset(String app, String code, String link, int codeMinutes, int linkMinutes) {
        String subject = "Reset your " + app + " password";
        Body b = new Body()
                .heading("Reset your password")
                .para("We received a request to reset the password of your " + app + " account. Enter this code in the app to choose a new one.")
                .code(code)
                .note("The code expires in " + codeMinutes + " minutes and can be used once.");
        if (link != null) {
            b.button("Choose a new password", link)
                    .note("The link expires in " + linkMinutes + " minutes.");
        }
        b.security("Never share this code with anyone, not even someone who says they work for " + app + ". If you did not ask for this, ignore this email: your password stays as it is.");
        return render(app, subject, b);
    }

    public static Email reminder(String app, String name, String practiceLink, String settingsLink) {
        String subject = "Time for some speaking practice?";
        Body b = new Body()
                .heading("Hi " + name + ",")
                .para("It has been a couple of days since your last conversation on " + app + ". A short call keeps your English fresh.")
                .button("Start practising", practiceLink)
                .note("You get this because practice reminders are turned on. You can turn them off at any time in Settings, Notifications.")
                .link("Notification settings", settingsLink);
        return render(app, subject, b);
    }

    // --- layout -----------------------------------------------------------------------------------------------------------------

    private static String hours(int h) { return h == 1 ? "1 hour" : h + " hours"; }

    /** Content blocks, kept in order so that the HTML and the text version always say the same thing. */
    private static final class Body {
        private final StringBuilder html = new StringBuilder();
        private final StringBuilder text = new StringBuilder();

        Body heading(String s) {
            html.append("<h1 style=\"margin:0 0 16px;font-size:24px;line-height:30px;font-weight:700;color:#14171a\">").append(esc(s)).append("</h1>");
            text.append(s).append("\n\n");
            return this;
        }

        Body para(String s) {
            html.append("<p style=\"margin:0 0 20px;font-size:16px;line-height:24px;color:#14171a\">").append(esc(s)).append("</p>");
            text.append(s).append("\n\n");
            return this;
        }

        Body code(String c) {
            html.append("<table role=\"presentation\" align=\"center\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:0 auto 12px\"><tr>")
                    .append("<td class=\"code\" style=\"background:#eef3fd;border:1px solid #cbd9f6;border-radius:10px;padding:14px 24px;")
                    .append("font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;line-height:40px;font-weight:700;")
                    .append("letter-spacing:8px;color:").append(ACCENT).append(";text-align:center\">").append(esc(c)).append("</td></tr></table>");
            text.append("YOUR CODE: ").append(c).append("\n\n");
            return this;
        }

        Body note(String s) {
            html.append("<p style=\"margin:0 0 20px;font-size:14px;line-height:21px;color:#5b6670;text-align:center\">").append(esc(s)).append("</p>");
            text.append(s).append("\n\n");
            return this;
        }

        Body button(String label, String url) {
            html.append("<table role=\"presentation\" align=\"center\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:0 auto 20px\"><tr>")
                    .append("<td style=\"background:").append(ACCENT).append(";border-radius:8px\"><a href=\"").append(esc(url))
                    .append("\" style=\"display:inline-block;padding:13px 26px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none\">")
                    .append(esc(label)).append("</a></td></tr></table>");
            text.append(label).append(":\n").append(url).append("\n\n");
            return this;
        }

        Body link(String label, String url) {
            html.append("<p style=\"margin:0 0 20px;font-size:14px;line-height:21px;text-align:center\"><a href=\"").append(esc(url))
                    .append("\" style=\"color:").append(ACCENT).append(";text-decoration:underline\">").append(esc(label)).append("</a></p>");
            text.append(label).append(":\n").append(url).append("\n\n");
            return this;
        }

        Body security(String s) {
            html.append("<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:8px 0 20px\"><tr>")
                    .append("<td style=\"background:#faf7ee;border-left:4px solid #c9a227;border-radius:4px;padding:12px 14px;font-size:14px;line-height:21px;color:#4a4330\">")
                    .append("<strong>Keep this private.</strong> ").append(esc(s)).append("</td></tr></table>");
            text.append("KEEP THIS PRIVATE. ").append(s).append("\n\n");
            return this;
        }
    }

    private static Email render(String app, String subject, Body b) {
        String html = "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
                + "<meta name=\"color-scheme\" content=\"light only\"><meta name=\"supported-color-schemes\" content=\"light only\">"
                + "<title>" + esc(subject) + "</title>"
                + "<style>@media only screen and (max-width:480px){.card{padding:24px 18px !important}.code{font-size:28px !important;letter-spacing:5px !important;padding:12px 16px !important}}</style>"
                + "</head><body style=\"margin:0;padding:0;background:#f4f6f5;-webkit-text-size-adjust:100%\">"
                + "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"background:#f4f6f5\"><tr><td align=\"center\" style=\"padding:24px 12px\">"
                + "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"max-width:560px\">"
                + "<tr><td style=\"background:" + NAVY + ";border-radius:12px 12px 0 0;padding:20px 28px;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:26px;font-weight:700;color:#ffffff\">" + esc(app) + "</td></tr>"
                + "<tr><td class=\"card\" style=\"background:#ffffff;border-radius:0 0 12px 12px;padding:32px 28px;font-family:Arial,Helvetica,sans-serif\">"
                + b.html
                + "<hr style=\"border:0;border-top:1px solid #e3e7e5;margin:8px 0 16px\">"
                + "<p style=\"margin:0;font-size:12px;line-height:18px;color:#7b858d;text-align:center\">This is an automated message from " + esc(app)
                + ". Please do not reply to it. " + esc(app) + " will never ask for your password or your code by email, phone or chat.</p>"
                + "</td></tr></table></td></tr></table></body></html>";
        String text = app + "\n" + "=".repeat(Math.max(8, app.length())) + "\n\n" + b.text
                + "--\nThis is an automated message from " + app + ". Please do not reply to it. " + app
                + " will never ask for your password or your code by email, phone or chat.\n";
        return new Email(subject, html, text);
    }

    static String esc(String s) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                case '\'' -> out.append("&#39;");
                default -> out.append(c);
            }
        }
        return out.toString();
    }
}
