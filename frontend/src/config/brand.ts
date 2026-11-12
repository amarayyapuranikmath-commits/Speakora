import { resolveAndroidDownloadUrl } from '../lib/androidDownload'

/** Branding lives here so the product can be renamed without touching components. Override via VITE_APP_NAME. */
export const brand = {
  name: (import.meta.env.VITE_APP_NAME as string | undefined) ?? 'Speakora',
  tagline: 'Practise speaking English with real people.',
  supportEmail: (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) ?? '',
  /** Public address of the signed release APK (or null until one is configured). Build-time: VITE_ANDROID_DOWNLOAD_URL. */
  androidDownloadUrl: resolveAndroidDownloadUrl(import.meta.env.VITE_ANDROID_DOWNLOAD_URL as string | undefined),
}
