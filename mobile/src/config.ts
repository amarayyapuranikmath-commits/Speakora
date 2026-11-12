/**
 * Where the app talks to. `apiUrl.generated.ts` is written by `npm run set-api-url -- https://your.domain` before a
 * release build (the web and the app use the same backend). In debug builds the address can also be changed on the
 * welcome screen, which is handy on a local network.
 */
import { GENERATED_API_URL } from './apiUrl.generated'

export const DEFAULT_API_URL = GENERATED_API_URL
export const APP_NAME = 'Speakora'
export const APP_VERSION = '0.1.0'
/**
 * Timestamped call diagnostics in logcat, and the 2-second connection report that feeds them. On in debug builds (Metro), off in release
 * builds: the report asks the WebRTC stack for statistics every 2 seconds for the whole call, only to write a log line nobody reads there.
 */
export const CALL_DEBUG = __DEV__
