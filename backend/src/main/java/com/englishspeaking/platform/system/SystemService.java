package com.englishspeaking.platform.system;

import com.englishspeaking.platform.calling.IceServerService;
import com.englishspeaking.platform.calling.TurnProbe;
import com.englishspeaking.platform.coach.TutorService;
import com.englishspeaking.platform.coach.CoachProvider;
import com.englishspeaking.platform.common.ApiException;
import com.englishspeaking.platform.notification.MailService;
import com.englishspeaking.platform.security.AppProperties;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Lets an administrator verify the external services with real credentials from inside the running app.
 * Reports contain no secrets: only whether each is configured, and the outcome of an actual test call.
 */
@Service
public class SystemService {
    public record Check(String name, boolean ok, String detail) {}

    public record Report(String baseUrl, boolean https, boolean cookieSecure, List<String> corsOrigins, boolean smtpConfigured,
                         String mailFrom, boolean coachConfigured, String coachModel, boolean turnConfigured, List<String> turnUrls,
                         boolean forceRelay, List<String> warnings) {}

    private final AppProperties props;
    private final MailService mail;
    private final CoachProvider coach;
    private final IceServerService ice;
    private final TurnProbe turnProbe;

    public SystemService(AppProperties props, MailService mail, CoachProvider coach, IceServerService ice, TurnProbe turnProbe) {
        this.props = props;
        this.mail = mail;
        this.coach = coach;
        this.ice = ice;
        this.turnProbe = turnProbe;
    }

    public Report report(UUID adminId) {
        // No network call here: the report only says whether a Turnix token is set (the addresses are issued per request).
        boolean turnConfigured = props.turn().configured();
        List<String> turnUrls = List.of();
        boolean https = props.baseUrl().toLowerCase().startsWith("https://");
        List<String> warnings = new ArrayList<>();
        if (!https) warnings.add("APP_BASE_URL is not https. Browsers only allow the microphone on https (or localhost).");
        if (!props.cookieSecure()) warnings.add("COOKIE_SECURE is false: the sign-in cookie is also sent over plain http.");
        if (props.corsOrigins().stream().anyMatch(o -> o.contains("localhost") || o.startsWith("http://"))) warnings.add("CORS allows a localhost or http origin.");
        if (!mail.isConfigured()) warnings.add("No email provider is configured (set RESEND_API_KEY or SMTP_HOST): verification, reset and reminder emails are only written to the server log.");
        if (!coach.isConfigured()) warnings.add("No AI provider key: the speaking coach reports itself unavailable.");
        if (!turnConfigured) warnings.add("TURNIX_API_TOKEN is not set: voice calls cannot start until TURN credentials can be issued.");
        if (props.adminEmailList().isEmpty()) warnings.add("ADMIN_EMAILS is empty: administrators can only be created with SQL.");
        return new Report(props.baseUrl(), https, props.cookieSecure(), props.corsOrigins(), mail.isConfigured(), mail.fromAddress(),
                coach.isConfigured(), coach.modelName(), turnConfigured, turnUrls, props.turn().forceRelay(), warnings);
    }

    /** Sends a real email through the configured provider (Resend or SMTP). */
    public Check testEmail(String to) {
        try {
            mail.sendChecked(to, "Test email from " + props.name(), "This is a test message sent from the admin System page.\nIf you can read it, email sending is working.");
            return new Check("email", true, "Sent to " + to + " from " + mail.fromAddress() + ". Check that inbox (and spam).");
        } catch (RuntimeException e) {
            return new Check("email", false, oneLine(e));
        }
    }

    /** Sends one canned question to the real AI provider and checks that a reply comes back. Nothing is stored. */
    public Check testCoach() {
        if (!coach.isConfigured()) return new Check("coach", false, "No GROQ_API_KEY is configured.");
        try {
            String reply = coach.chat("You are an English tutor. Reply with one short sentence.", List.of(new TutorService.Turn("user", "Say hello and ask how my day was.")));
            boolean useful = reply != null && !reply.isBlank();
            return new Check("coach", useful, useful ? "Provider " + coach.modelName() + " answered (" + reply.strip().length() + " characters). Nothing was stored." : "The provider answered with nothing. Check the model name.");
        } catch (CoachProvider.CoachException e) {
            return new Check("coach", false, e.getMessage());
        }
    }

    /** Performs a real authenticated TURN allocation using the credentials Turnix just issued (this makes one real Turnix request). */
    public Check testTurn(UUID adminId) {
        IceServerService.IceConfig cfg;
        try {
            cfg = ice.forClient(null);
        } catch (ApiException e) {
            return new Check("turn", false, e.getMessage());
        }
        var turn = cfg.iceServers().stream().filter(s -> s.username() != null).findFirst().orElseThrow();
        List<String> results = new ArrayList<>();
        boolean anyOk = false, probed = false;
        for (String url : turn.urls()) {
            if (!url.toLowerCase().startsWith("turn:") || url.toLowerCase().contains("transport=tcp")) {
                results.add(url + ": not probed (this check covers turn: over UDP only; test turns:/TCP from a real browser)");
                continue;
            }
            probed = true;
            try {
                URI uri = URI.create(url.replace("turn:", "turn://").split("\\?")[0]);
                int port = uri.getPort() > 0 ? uri.getPort() : 3478;
                TurnProbe.Result r = turnProbe.probe(uri.getHost(), port, turn.username(), turn.credential(), Duration.ofSeconds(4));
                anyOk |= r.ok();
                results.add(url + ": " + r.message() + (r.relayAddress() != null ? " Relay " + r.relayAddress() + "." : ""));
            } catch (IllegalArgumentException e) {
                results.add(url + ": not a valid TURN url");
            }
        }
        if (!probed) return new Check("turn", false, String.join(" | ", results));
        return new Check("turn", anyOk, String.join(" | ", results));
    }

    private static String oneLine(Exception e) {
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        m = m.replaceAll("\\s+", " ");
        return m.length() > 300 ? m.substring(0, 300) : m;
    }

    public static ApiException badRecipient() { return ApiException.badRequest("INVALID_EMAIL", "Enter a valid email address."); }
}
