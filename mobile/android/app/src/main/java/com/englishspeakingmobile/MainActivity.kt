package com.englishspeakingmobile

import android.os.Bundle
import androidx.appcompat.app.AppCompatDelegate
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /** The launch screen theme shows the Speakora logo while the app starts; switch to the normal theme before the first screen is created. */
  override fun onCreate(savedInstanceState: Bundle?) {
    // Light is the default. Until the app reads the person's saved choice, native parts (the first window, dialogs) are light even on a phone
    // set to dark; JavaScript then switches Android to dark or to the phone's own setting only if the person chose that in Settings.
    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
    setTheme(R.style.AppTheme)
    super.onCreate(savedInstanceState)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "EnglishSpeakingMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
