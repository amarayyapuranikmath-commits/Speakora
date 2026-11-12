# Real-device voice test: exact steps

Automated tests prove the pipeline with a fake microphone on one machine. Only you can prove it works for humans. This takes about 30 minutes.

## What you need
- Two devices, each with a microphone and speaker. Best: your phone and a laptop. **Headphones on both** (otherwise you hear echo that is not a bug).
- The app on a **public HTTPS address** (deployed, see DEPLOYMENT.md). Phones will not allow the microphone on a plain `http://192.168...` address. For a quick trial from a laptop, `http://localhost:5173` works on that laptop only.
- Two accounts (register two, one per device).
- Optional but recommended: the admin **System** tab shows "TURN relay: Configured" and its test is green.

## The test matrix: run each row, write down the result

| # | Setup | What to do | Pass if |
|---|---|---|---|
| 1 | Both devices on the **same Wi-Fi** | Both press *Start looking*. Talk for 2 minutes. | They match within seconds; each hears the other clearly; the timer runs; quality shows Good |
| 2 | Phone on **mobile data**, laptop on Wi-Fi | Same | Connects (may take a few extra seconds); voice is clear |
| 3 | Both on **different** Wi-Fi/ISP networks | Same | Connects; if it fails with relay off, repeat with `TURN_FORCE_RELAY=true` and note it |
| 4 | **Mute**: during a call | Mute on A; B should hear nothing. Unmute: B hears A again | Both directions behave; the button label and "your microphone is muted" notice match |
| 5 | **Speaker**: on one device | Tap *Speaker*; you should stop hearing the partner; tap again to hear | Works on both |
| 6 | **Microphone choice** | With a headset plugged in, open the Microphone menu (shown when 2+ mics exist) and switch | Partner hears you through the new mic without the call dropping |
| 7 | **Short outage** | On A, switch Wi-Fi off for ~5 s, then on | A and B show "Reconnecting…"; the call recovers by itself; audio resumes |
| 8 | **Network switch** | On the phone, go from Wi-Fi to mobile data mid-call | The call recovers within ~20 s; if not, note what the screen said |
| 9 | **Long outage** | Turn A's network off for 40 s | B sees "Call ended" (partner lost connection); when A is back online, A sees the call ended too |
| 10 | **Permission denied** | Block the microphone for the site in the browser, press *Start looking* | A clear message explains how to allow the microphone; no crash |
| 11 | **Skip and end** | Press *Skip* mid-call; then *End call* on the next | Skip finds a new partner (needs a third account); End shows feedback |
| 12 | **Background** (phone) | Lock the screen or switch apps for 10 s mid-call | Note whether audio continues. Mobile browsers may suspend tabs; this is a known browser limit, not something the site can change |

## Testing the Android app (phone ↔ phone, or phone ↔ laptop browser)

The app has been built and unit-tested but **nobody has made a call with it yet**; this section is how you find out.

1. Build and install (see `mobile/README.md`). For a first trial on your home Wi-Fi you do not need a domain:
   - Start the backend and Redis on your PC; note the PC's LAN address, for example `192.168.1.20` (`ipconfig`).
   - `cd mobile; npm run set-api-url -- http://192.168.1.20:8080`, then `cd android; .\gradlew.bat assembleDebug`.
   - Allow Java through the Windows firewall for private networks, and set `CORS_ORIGINS`/`WS_ALLOWED_ORIGINS` only if the backend rejects the app (the app sends no `Origin` header, so normally nothing is needed).
   - `adb install -r android\app\build\outputs\apk\debug\app-debug.apk` (phone with USB debugging), or copy the APK to the phone.
   - Debug builds permit plain `http://` on the local network; **release builds do not**, so a release APK needs your HTTPS domain baked in with `npm run set-api-url`.
2. Sign in on the phone and in a laptop browser with two different accounts, and run rows 1, 4, 5, 7, 8, 9, 10, 11 above. Android-specific rows:

| # | What to do | Pass if |
|---|---|---|
| A1 | First *Start looking* | Android asks for the microphone, then (Android 13+) for notifications; calls work either way |
| A2 | Deny the microphone, then press *Start looking* again; then tick "don't ask again" | A clear message; after a permanent denial an **Open app settings** button appears and works |
| A3 | During a call press Home, open another app for 30 s, come back | Audio continued; the ongoing "In a call with …" notification was visible; tapping it returns to the app |
| A4 | Lock the screen for 30 s mid-call | Audio continues (foreground service); the call is still connected on unlock |
| A5 | Plug in or connect Bluetooth headphones mid-call | Audio follows the headset; *Speaker* switches to the loudspeaker and back |
| A6 | Receive a phone call mid-call, then end it | Note what happens; the app should still be in the call or have ended it cleanly, never stuck |
| A7 | Switch tabs while searching or in a call | A green banner "In a call with …" appears above the tab bar and returns you to the call |
| A8 | Kill the app from recents during a call | The partner sees the call end within ~20 s |

## How to judge quality
- **Clear**: you can follow without asking them to repeat. **Delay**: a noticeable lag before answers (over ~0.5 s is poor). **Glitches**: robotic or dropped words (the quality indicator should drop to Fair/Poor at the same time).
- The indicator uses real packet loss, round-trip time and jitter from the call, refreshed every 2 seconds.

## What to send back
For each row: pass/fail, the two devices and browsers (for example "iPhone Safari 18 / Windows Chrome 130"), the network types, and for failures what the screen said and roughly when. If a call failed to connect: ask an admin to open **System, Test TURN** and send its text. Server logs carry an `X-Request-Id`; the request id of a failing action (browser DevTools, Network tab) lets the logs be found.

## If rows 2 or 3 fail
Calls across strict NATs need TURN. Follow TURN.md to deploy coturn, run **Test TURN** until it is green, then repeat rows 2 and 3.


## Android: the checks that need a person with the phone (redesign and voice)

Install the latest debug APK first (`adb install -r mobile\android\app\build\outputs\apk\debug\app-debug.apk`), start the backend and Metro, and run
`adb reverse tcp:8080 tcp:8080` and `adb reverse tcp:8081 tcp:8081`.

1. **Typed text** (phone in dark mode is fine): type in AI Coach, a friend chat, search / topic fields, sign-up and login. The text, cursor and
   placeholder must be clearly visible, and the box must stay above the keyboard (also with several lines).
2. **Tabs and header**: all six tabs open; there is no top header; the status bar is clear of the content; Settings and Sign out are in the avatar on Home.
3. **Speaking speed**: AI Coach > mode menu > Tutor settings > Speaking speed. Tap **Hear a sample** on Slow, Normal and Fast: Normal should be easy to follow
   with a clear pause after each sentence. Start a voice conversation (allow the microphone, speak a sentence), listen to a reply, tap **Interrupt**, end the
   conversation, and take a phone call while the tutor speaks.
4. **Auth**: sign up (the verification screen opens straight away and cannot be skipped; the code arrives by email, or is in the backend log without SMTP), wrong then right code, Send a new code (immediate; try it twice, and with the backend stopped to see the failure message), Sign out if the address was wrong;
   Forgot password, code and new password, sign in with it.
5. **Friends and chat**: list, Message / Call / three-dot menu, send and receive messages, scroll up for older ones.
6. **Dashboard**: scrolls fully, Continue learning opens the real next lesson, the three subjects open their levels.
7. **Coach voice turns (new)**: open AI Coach and tap the microphone. Speak a sentence slowly with a pause in the middle: the coach must keep waiting through a pause of one or two seconds
   inside a sentence, answer soon after you finish a complete sentence, and **Done** must end your turn at once. Words should appear as the coach speaks them, never ahead of the voice, and
   the screen should follow the newest text. Tap **Interrupt** while it speaks: it stops at once and only the spoken part stays. Leave the screen and come back: the conversation is gone (nothing is stored).
8. **Learn (new)**: Learn > Today shows one plan; finish a part and return, and it says what is left. A word shows Kannada only after Kannada is chosen as the explanation language in Settings.
   The speaker button should read the word aloud. Note anything in Kannada that reads wrongly: it has not been reviewed by a native speaker.
