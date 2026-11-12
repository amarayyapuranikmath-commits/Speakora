/**
 * Validates the configured Android download address (VITE_ANDROID_DOWNLOAD_URL).
 * Accepts an https:// address on a public host, or a same-site path such as /downloads/speakora.apk.
 * Anything else (empty, http://, localhost, emulator or private-network addresses, file paths) yields null, so the
 * site never shows a download button that cannot work for visitors.
 */
export function resolveAndroidDownloadUrl(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (value.startsWith('/') && !value.startsWith('//')) return value
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  const local =
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '10.0.2.2' ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '[::1]' || !host.includes('.')
  return local ? null : url.toString()
}
