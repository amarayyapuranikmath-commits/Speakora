package com.englishspeakingmobile

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

/**
 * Speech for the AI tutor, built directly on the two services Android already provides:
 *  - speech to text: android.speech.SpeechRecognizer. Depending on the phone this is the Google speech service, which may send the
 *    audio to Google to be recognised (an on-device model is preferred when one is installed). The app never receives, records or stores audio:
 *    only the recognised text reaches JavaScript.
 *  - text to speech: android.speech.tts.TextToSpeech, which speaks on the device.
 * Neither judges pronunciation, and nothing here pretends to. Speaking asks for audio focus, so a phone call or another app that
 * takes the audio stops the tutor's voice and JavaScript is told ("interrupted").
 *
 * Events (RCTDeviceEventEmitter): speechReady, speechPartial {text}, speechResult {text}, speechError {code}, speechEnd,
 * ttsStart {id}, ttsRange {id, start, end}, ttsDone {id}, ttsError {id}, ttsInterrupted.
 */
class SpeechModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  override fun getName() = "EsSpeech"

  private companion object {
    const val SILENCE_SUFFIX = "~pause"
  }

  private var recognizer: SpeechRecognizer? = null
  private var tts: TextToSpeech? = null
  private var ttsState = 0 // 0 = not started, 1 = starting, 2 = ready, -1 = failed
  private val ttsWaiting = mutableListOf<Promise>()
  private val queued = AtomicInteger(0)
  private val audio by lazy { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
  private var focusRequest: AudioFocusRequest? = null

  init { context.addLifecycleEventListener(this) }

  private fun emit(name: String, params: WritableMap? = null) {
    if (!context.hasActiveReactInstance()) return
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, params)
  }

  // Required by NativeEventEmitter.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  // ---------------------------------------------------------------- availability

  @ReactMethod
  fun status(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val map = Arguments.createMap()
      map.putBoolean("recognition", SpeechRecognizer.isRecognitionAvailable(context))
      map.putBoolean("permission", context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
      promise.resolve(map)
    }
  }

  // ---------------------------------------------------------------- speech to text

  @ReactMethod
  fun startListening(locale: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
          promise.reject("permission", "The microphone permission is not granted.")
          return@runOnUiThread
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
          promise.reject("unavailable", "This phone has no speech recognition service.")
          return@runOnUiThread
        }
        // Only one listening session at a time; a new one replaces the old.
        destroyRecognizer()
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        r.setRecognitionListener(listener)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
          putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
          // Hints that people pause while they think: ask the recogniser not to end the recording after about a second of silence.
          // Some speech services ignore them, so JavaScript also keeps the words and starts a new recording when the phone ends one,
          // and decides itself when the turn is over (src/lib/turn.ts).
          putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
          putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 3500L)
          putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        }
        recognizer = r
        r.startListening(intent)
        promise.resolve(null)
      } catch (e: Exception) {
        destroyRecognizer()
        promise.reject("failed", e.message ?: "Speech recognition could not start.")
      }
    }
  }

  /** Finish now: whatever was heard so far is delivered as the final result. */
  @ReactMethod
  fun stopListening() {
    UiThreadUtil.runOnUiThread { try { recognizer?.stopListening() } catch (_: Exception) {} }
  }

  /** Abort: nothing more is delivered. */
  @ReactMethod
  fun cancelListening() {
    UiThreadUtil.runOnUiThread { destroyRecognizer() }
  }

  private fun destroyRecognizer() {
    val r = recognizer ?: return
    recognizer = null
    try { r.cancel() } catch (_: Exception) {}
    try { r.destroy() } catch (_: Exception) {}
  }

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) { emit("speechReady") }
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() { emit("speechEnd") }
    override fun onEvent(eventType: Int, params: Bundle?) {}

    override fun onPartialResults(partialResults: Bundle?) {
      val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
      emit("speechPartial", Arguments.createMap().apply { putString("text", text) })
    }

    override fun onResults(results: Bundle?) {
      val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
      emit("speechResult", Arguments.createMap().apply { putString("text", text) })
      destroyRecognizer()
    }

    override fun onError(error: Int) {
      emit("speechError", Arguments.createMap().apply { putString("code", errorCode(error)) })
      destroyRecognizer()
    }
  }

  private fun errorCode(error: Int) = when (error) {
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "network"
    SpeechRecognizer.ERROR_AUDIO -> "audio"
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
    SpeechRecognizer.ERROR_NO_MATCH -> "no-match"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "busy"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission"
    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "language"
    else -> "failed"
  }

  // ---------------------------------------------------------------- text to speech

  /** Starts the speech engine if needed. Resolves true when ready, false when this phone has none. */
  @ReactMethod
  fun prepareSpeech(promise: Promise) {
    when (ttsState) {
      2 -> promise.resolve(true)
      -1 -> promise.resolve(false)
      1 -> synchronized(ttsWaiting) { ttsWaiting.add(promise) }
      else -> {
        ttsState = 1
        synchronized(ttsWaiting) { ttsWaiting.add(promise) }
        UiThreadUtil.runOnUiThread {
          tts = TextToSpeech(context.applicationContext) { status ->
            ttsState = if (status == TextToSpeech.SUCCESS) 2 else -1
            if (ttsState == 2) {
              tts?.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
              tts?.setOnUtteranceProgressListener(progress)
            }
            synchronized(ttsWaiting) { ttsWaiting.forEach { it.resolve(ttsState == 2) }; ttsWaiting.clear() }
          }
        }
      }
    }
  }

  /**
   * Queues one piece of text. Pieces are spoken in order; the id comes back in ttsStart / ttsDone / ttsError.
   * [rate] is the engine's speech rate (1.0 is the engine's own normal speed, which is brisk for a learner), [pauseMs] is a silence after the
   * piece so sentences do not run into each other. Pitch stays at the natural 1.0: changing it makes voices sound robotic.
   */
  @ReactMethod
  fun speak(id: String, text: String, locale: String, rate: Double, pauseMs: Int, promise: Promise) {
    val engine = tts
    if (ttsState != 2 || engine == null) { promise.reject("unavailable", "Text to speech is not available on this phone."); return }
    val tag = Locale.forLanguageTag(locale)
    when (engine.isLanguageAvailable(tag)) {
      TextToSpeech.LANG_MISSING_DATA, TextToSpeech.LANG_NOT_SUPPORTED -> { /* keep the engine's default voice rather than failing */ }
      else -> engine.language = tag
    }
    if (queued.getAndIncrement() == 0 && !takeFocus()) {
      queued.decrementAndGet()
      promise.reject("busy", "Another app is using the audio.")
      return
    }
    engine.setSpeechRate(rate.toFloat().coerceIn(0.4f, 1.5f))
    engine.setPitch(1.0f)
    val result = engine.speak(text.take(3900), TextToSpeech.QUEUE_ADD, null, id)
    if (result != TextToSpeech.SUCCESS) {
      finishOne()
      promise.reject("failed", "The phone could not speak that.")
      return
    }
    // A natural pause after the sentence. It is queued like any utterance (and counted, so audio focus is released only after it).
    if (pauseMs > 0 && engine.playSilentUtterance(pauseMs.toLong().coerceAtMost(2000L), TextToSpeech.QUEUE_ADD, id + SILENCE_SUFFIX) == TextToSpeech.SUCCESS) {
      queued.incrementAndGet()
    }
    promise.resolve(null)
  }

  /** Stops speaking at once and drops everything still queued (an interruption by the learner). */
  @ReactMethod
  fun stopSpeaking() {
    try { tts?.stop() } catch (_: Exception) {}
    queued.set(0)
    giveFocus()
  }

  private val progress = object : UtteranceProgressListener() {
    // The silence after a sentence has its own id; JavaScript only hears about the sentences themselves.
    override fun onStart(utteranceId: String?) { if (!isSilence(utteranceId)) emit("ttsStart", idMap(utteranceId)) }
    override fun onDone(utteranceId: String?) { if (!isSilence(utteranceId)) emit("ttsDone", idMap(utteranceId)); finishOne() }
    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String?) { if (!isSilence(utteranceId)) emit("ttsError", idMap(utteranceId)); finishOne() }
    override fun onStop(utteranceId: String?, interrupted: Boolean) {}
    // Where the engine is in the sentence (Android 8 and newer, engines that report it): lets the screen show only the words spoken so far.
    override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
      if (isSilence(utteranceId)) return
      emit("ttsRange", Arguments.createMap().apply { putString("id", utteranceId ?: ""); putInt("start", start); putInt("end", end) })
    }
  }

  private fun isSilence(id: String?) = id != null && id.endsWith(SILENCE_SUFFIX)

  private fun idMap(id: String?) = Arguments.createMap().apply { putString("id", id ?: "") }

  private fun finishOne() {
    if (queued.updateAndGet { if (it > 0) it - 1 else 0 } == 0) giveFocus()
  }

  // ---------------------------------------------------------------- audio focus (phone calls and other apps)

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
      try { tts?.stop() } catch (_: Exception) {}
      queued.set(0)
      emit("ttsInterrupted")
    }
  }

  private fun takeFocus(): Boolean {
    val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setOnAudioFocusChangeListener(focusListener)
      .build()
    focusRequest = request
    return audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
  }

  private fun giveFocus() {
    focusRequest?.let { audio.abandonAudioFocusRequest(it) }
    focusRequest = null
  }

  // ---------------------------------------------------------------- lifecycle

  /** Leaving the app ends listening and speaking: the tutor never keeps the microphone while the app is not in view. */
  override fun onHostPause() {
    UiThreadUtil.runOnUiThread { destroyRecognizer() }
    try { tts?.stop() } catch (_: Exception) {}
    queued.set(0)
    giveFocus()
  }
  override fun onHostResume() {}
  override fun onHostDestroy() { release() }

  override fun invalidate() {
    release()
    super.invalidate()
  }

  private fun release() {
    UiThreadUtil.runOnUiThread { destroyRecognizer() }
    try { tts?.stop(); tts?.shutdown() } catch (_: Exception) {}
    tts = null
    ttsState = 0
    giveFocus()
  }
}
