import notifee, { AndroidForegroundServiceType, AndroidImportance } from '@notifee/react-native'
import { PermissionsAndroid, Platform } from 'react-native'
import { APP_NAME } from '../../config'

const CHANNEL_ID = 'calls'
const NOTIFICATION_ID = 'active-call'

/** Registered once at startup (index.js). The promise never resolves: the service lives until stopForegroundService(). */
export function registerForegroundService() {
  notifee.registerForegroundService(() => new Promise<void>(() => undefined))
}

/** True while the foreground service is running, so later updates never try to start it a second time. */
let serviceRunning = false

/**
 * While a call or search is live, run a foreground service of type "microphone" with an ongoing notification. Without it
 * Android silences the microphone and may kill the app a few seconds after the user switches to another app.
 *
 * Android only lets an app START a microphone foreground service while it is visible and already holds the RECORD_AUDIO
 * permission. Callers start it right after the microphone was opened from the Talk screen (the app is in the foreground),
 * and later changes of the text (partner found, call connected) only UPDATE the existing notification, which is allowed
 * from the background. Every failure is contained: the call still works in the foreground, only background survival is lost.
 */
export async function showCallNotification(partnerName: string | null) {
  if (Platform.OS !== 'android') return
  try {
    const channelId = await notifee.createChannel({ id: CHANNEL_ID, name: 'Calls', importance: AndroidImportance.LOW })
    const base = {
      id: NOTIFICATION_ID,
      title: partnerName ? `In a call with ${partnerName}` : 'Looking for a partner',
      body: `${APP_NAME}. Tap to return.`,
    }
    const android = { channelId, ongoing: true, onlyAlertOnce: true, pressAction: { id: 'default' }, smallIcon: 'ic_launcher' }
    if (serviceRunning) {
      await notifee.displayNotification({ ...base, android }) // same id: updates the foreground notification in place
      return
    }
    if (Number(Platform.Version) >= 33) await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never)
    await notifee.displayNotification({
      ...base,
      android: { ...android, asForegroundService: true, foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE] },
    })
    serviceRunning = true
  } catch (e) {
    console.warn('Could not start the call notification', e)
  }
}
export async function endCallNotification() {
  if (Platform.OS !== 'android') return
  serviceRunning = false
  try {
    await notifee.stopForegroundService()
    await notifee.cancelNotification(NOTIFICATION_ID)
  } catch {
    // nothing running
  }
}
