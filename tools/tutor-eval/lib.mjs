// Pure helpers for the tutor evaluation: pacing against provider rate limits, Retry-After, duplicate detection, resumable state.
// No network here, so all of it is unit-tested (lib.test.mjs) without spending any provider quota.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Minimum gap between two requests. Groq limits requests per minute (RPM) AND tokens per minute (TPM); a tutor request costs
 * roughly a system prompt + context + a short reasoning pass + the answer, so the token limit is usually the one that bites.
 * Look up your real limits in the Groq console (Settings > Limits) and set EVAL_RPM / EVAL_TPM accordingly.
 */
export function computeGapMs({ rpm = 30, tpm = 8000, tokensPerRequest = 1800, gapMs } = {}) {
  if (Number.isFinite(gapMs) && gapMs >= 0) return Math.round(gapMs)
  const byRequests = 60_000 / Math.max(1, rpm)
  const byTokens = (tokensPerRequest / Math.max(1, tpm)) * 60_000
  return Math.ceil(Math.max(byRequests, byTokens))
}

/** Retry-After as whole seconds (rounded up): "12", "7.2" or an HTTP date. Null when absent or unreadable. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const text = String(value).trim()
  const n = Number(text)
  if (Number.isFinite(n)) return n < 0 ? null : Math.ceil(n)
  const date = Date.parse(text)
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000))
}

/** Spaces requests out, and slows down further each time the provider says it is being hit too hard. */
export class Pacer {
  constructor(gapMs, { now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxGapMs = 60_000 } = {}) {
    this.gapMs = gapMs
    this.now = now
    this.sleep = sleep
    this.maxGapMs = maxGapMs
    this.last = null
    this.waited = 0
  }

  /** Resolves when it is polite to send the next request. */
  async beforeRequest() {
    if (this.last !== null) {
      const remaining = this.gapMs - (this.now() - this.last)
      if (remaining > 0) { this.waited += remaining; await this.sleep(remaining) }
    }
    this.last = this.now()
  }

  slowDown() { this.gapMs = Math.min(this.maxGapMs, Math.max(1000, Math.ceil(this.gapMs * 1.5))) }
}

/**
 * Sentences as a reader sees them: markdown symbols removed, and every line break ends a sentence, so a heading or a list item that has
 * no full stop is not glued to the next sentence (which made a simple reply look like it had 26-word sentences).
 */
export function readerSentences(text) {
  return text.replace(/[*_`#>]/g, '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.split(/\s+/).filter(Boolean).length >= 1 && /[\p{L}\p{N}]/u.test(x))
}

/** Average words per reader sentence. */
export function avgSentenceWords(text) {
  const s = readerSentences(text)
  if (!s.length) return 0
  return s.reduce((n, x) => n + x.split(/\s+/).filter(Boolean).length, 0) / s.length
}

/** Sentences (4+ words) that appear more than once in a reply, ignoring case, quotes, bullets and punctuation. */
export function findDuplicateSentences(text) {
  const norm = (s) => s.toLowerCase().replace(/[*_`"'“”‘’]/g, '').replace(/^[\s\-•\d.)]+/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  const parts = text.replace(/\n+/g, '. ').split(/(?<=[.!?:;])\s+|\n/).map(norm).filter((s) => s.split(' ').length >= 4)
  const seen = new Set()
  const dup = new Set()
  for (const s of parts) { if (seen.has(s)) dup.add(s); else seen.add(s) }
  return [...dup]
}

/** Quoted phrases (2+ words, in straight or curly double quotes) that occur more than once: e.g. a "mistake" identical to its "correction". */
export function repeatedQuotes(text) {
  const found = [...text.matchAll(/["“]([^"”\n]{4,120})["”]/g)].map((m) => m[1].toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()).filter((q) => q.split(' ').length >= 2)
  const seen = new Set()
  const dup = new Set()
  for (const q of found) { if (seen.has(q)) dup.add(q); else seen.add(q) }
  return [...dup]
}

/** Curly apostrophes and quotes to straight ones, so a check written with can't also matches can’t. */
export const plain = (t) => t.replace(/[’‘]/g, "'").replace(/[“”]/g, '"')

// ---------------------------------------------------------------------------------------------- resumable state

export function emptyState() { return { version: 1, account: null, scenarios: {} } }

export function loadState(path) {
  if (!existsSync(path)) return emptyState()
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'))
    return s && s.version === 1 && s.scenarios ? s : emptyState()
  } catch { return emptyState() }
}

/** Written to a temp file first so an interrupted run can never leave a half-written state behind. */
export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, path)
}

export function resetState(path) { if (existsSync(path)) rmSync(path) }

/** Which scenarios still have to run. `only` limits to ids; `redo` forgets earlier results for those ids first. */
export function pendingScenarios(all, state, { only = [], redo = [] } = {}) {
  for (const id of redo) delete state.scenarios[id]
  // --redo=x means "run x again" and nothing else, unless --only says otherwise: it must never start a broader run by accident.
  const wanted = only.length ? only : redo
  return all.filter((s) => (wanted.length === 0 || wanted.includes(s.id)) && !state.scenarios[s.id]?.done)
}

export function parseArgs(argv) {
  const out = { only: [], redo: [], reset: false, report: false, dryRun: false }
  for (const a of argv) {
    if (a.startsWith('--only=')) out.only = a.slice(7).split(',').filter(Boolean)
    else if (a.startsWith('--redo=')) out.redo = a.slice(7).split(',').filter(Boolean)
    else if (a === '--reset') out.reset = true
    else if (a === '--report') out.report = true
    else if (a === '--dry-run') out.dryRun = true
  }
  return out
}
