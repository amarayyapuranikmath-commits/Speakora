/**
 * Deciding when the learner has finished speaking.
 *
 * The browser's and the phone's speech recognisers end a recording after about a second of silence. That is far too short for a person
 * who is thinking, or who is still learning the language, so this module sits on top of them: the recogniser keeps delivering words, and
 * THIS decides when the turn is over. It is plain logic with no dependency on any speech API (the same file is used on the website and
 * in the Android app) and it is honest about what it can see: only the recognised words and when they changed. It has no access to the
 * audio, so it does not "understand" tone or intonation; it uses the words, how long it has been quiet, and how this learner has paused so far.
 *
 * How long to wait after the last new word (silence):
 *  - clearly unfinished (ends in "and", "because", "I", "to", "um"...): a long wait;
 *  - a very short answer that is complete on its own ("yes", "thank you"): a short wait;
 *  - one or two other words: a long wait, they may be starting a sentence;
 *  - an ordinary complete-looking sentence: a medium wait;
 *  - longer for beginners (A1/A2) and for learners whose level is not known;
 *  - never shorter than how long this learner has already paused in the middle of a turn (adaptive), plus a margin;
 *  - the learner can end a turn at once: with the Done control, or by saying "that's all" / "I'm done".
 */

export const MIN_WAIT_MS = 900
export const MAX_WAIT_MS = 7000
/** A turn never runs longer than this: it is sent even if the learner is still talking, so nothing is lost. */
export const MAX_TURN_MS = 120_000
/** Pauses shorter than this are just breathing between words and teach nothing about the learner's rhythm. */
const PAUSE_THRESHOLD_MS = 600

/**
 * Words a sentence cannot end on: the learner is clearly still going. Auxiliary verbs are left out on purpose, because short answers
 * end on them all the time ("Yes, I do.", "They are.", "I think you should.").
 */
const UNFINISHED_ENDINGS = new Set([
  'and', 'but', 'or', 'so', 'because', 'cause', 'if', 'when', 'while', 'although', 'though', 'unless', 'until', 'since', 'that', 'which', 'who', 'whose',
  'where', 'whom', 'then', 'than', 'as', 'to', 'of', 'in', 'on', 'at', 'with', 'for', 'from', 'by', 'about', 'into', 'onto', 'over', 'under', 'between',
  'the', 'a', 'an', 'my', 'your', 'his', 'our', 'their', 'this', 'these', 'those', 'some', 'any', 'every', 'each', 'very', 'really', 'more', 'most', 'not',
  'i', "i'm", "i've", "i'll", "i'd", 'we', "we're", "we've", 'they', "they're", "they've", 'he', "he's", 'she', "she's",
  "it's", "that's", "there's", "what's", 'also', 'like', 'um', 'uh', 'er', 'erm', 'hmm', 'mm', 'well', 'actually', 'maybe', 'just', 'how', 'what', 'why',
  'such', 'both', 'either', 'neither', 'after', 'before', 'during', 'through', 'without', 'within', 'around', 'against', 'among',
])

/**
 * "is", "am", "are", "was", "were" at the end usually mean the sentence is not finished ("My name is", "English is"), except after a
 * pronoun or "there" ("what it is", "where he is", "yes I am") and in a plain yes/no answer.
 */
const COPULAS = new Set(['is', 'am', 'are', 'was', 'were', 'be', 'been', 'being'])
const AFTER_WHICH_COPULA_ENDS = new Set(['it', 'he', 'she', 'that', 'there', 'here', 'they', 'we', 'you', 'i', 'this', 'what', 'who', 'where', 'how', 'when', 'why'])
const YES_NO = new Set(['yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'sure', 'definitely', 'absolutely', 'maybe'])

/** Short replies that are complete on their own. */
const COMPLETE_ALONE = new Set([
  'yes', 'no', 'yeah', 'yep', 'nope', 'ok', 'okay', 'sure', 'thanks', 'thank you', 'hello', 'hi', 'hey', 'bye', 'goodbye', 'please', 'correct', 'right',
  'exactly', 'fine', 'good', 'great', 'nice', 'definitely', 'of course', 'i see', 'i know', "i don't know", 'not sure', 'no problem', 'sounds good',
  'go on', 'next', 'repeat', 'again', 'stop',
])

const DONE_PHRASE = /(?:^|[\s,.])(that'?s all|that is all|that'?s everything|i'?m done|i am done|i'?m finished|i am finished|i have finished|i'?ve finished|that'?s it for now)[\s.!]*$/i

const norm = (text: string) => text.replace(/[‘’]/g, "'")
const words = (text: string) => norm(text).trim().split(/\s+/).filter(Boolean)
const bare = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')

/** True when the text ends with a phrase that says the learner is done ("that's all", "I'm done"), and something was said before it. */
export function saidDone(text: string): boolean {
  const t = norm(text).trim()
  const m = DONE_PHRASE.exec(t)
  if (!m) return false
  return words(t.slice(0, m.index)).length > 0
}

/** The text without a closing "that's all" / "I'm done" (only removed when the learner said something before it). */
export function withoutDonePhrase(text: string): string {
  const t = norm(text).trim()
  const m = DONE_PHRASE.exec(t)
  if (!m) return text.trim()
  const before = t.slice(0, m.index).trim()
  return before ? before : text.trim()
}

export type Completeness = 'done' | 'complete-alone' | 'unfinished' | 'short' | 'sentence'

/** What the words alone say about whether the learner has finished. */
export function completenessOf(text: string): Completeness {
  const t = text.trim()
  if (!t) return 'short'
  if (saidDone(t)) return 'done'
  const ws = words(t)
  const flat = ws.map(bare).filter(Boolean)
  if (flat.length === 0) return 'short'
  if (flat.length <= 3 && COMPLETE_ALONE.has(flat.join(' '))) return 'complete-alone'
  const punctuated = /[.!?]["')\]]*$/.test(t)
  const last = flat[flat.length - 1]
  if (!punctuated) {
    if (UNFINISHED_ENDINGS.has(last)) return 'unfinished'
    if (COPULAS.has(last) && !YES_NO.has(flat[0]) && !(flat.length > 1 && AFTER_WHICH_COPULA_ENDS.has(flat[flat.length - 2]))) return 'unfinished'
  }
  if (flat.length <= 2) return 'short'
  return 'sentence'
}

export interface WaitContext {
  /** CEFR level of the learner, when known (A1..C2). */
  level?: string | null
  /** The longest pause in the middle of a turn that this learner has made in this session, in ms. */
  longestPauseMs?: number
}

const levelFactor = (level?: string | null) => {
  switch ((level ?? '').toUpperCase()) {
    case 'A1': case 'A2': return 1.4
    case 'B1': return 1.15
    case 'B2': case 'C1': case 'C2': return 1
    default: return 1.25 // unknown: assume a learner who needs a little more time
  }
}

/** How long to stay silent-and-wait after the last recognised word before the turn is considered finished. Exported for tests. */
export function silenceBeforeEnd(text: string, ctx: WaitContext = {}): number {
  const kind = completenessOf(text)
  if (kind === 'done') return 350
  const t = text.trim()
  const terminal = /[.!?]["')\]]*$/.test(t)
  const n = words(t).length
  let base: number
  switch (kind) {
    case 'complete-alone': base = 1300; break
    case 'unfinished': base = 4200; break
    case 'short': base = 3000; break
    default: base = terminal ? 1900 : n >= 4 ? 2300 : 2600
  }
  let wait = base * levelFactor(ctx.level)
  if (ctx.longestPauseMs && kind !== 'complete-alone') wait = Math.max(wait, ctx.longestPauseMs * 1.25)
  return Math.round(Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, wait)))
}

export interface TurnTaker {
  /** The recogniser's words so far for this turn (everything the learner has said, final and not yet final). Call whenever it changes. */
  update(text: string): void
  /** The learner ended the turn (Done control): deliver now. */
  finishNow(): void
  /** Forget the current turn without delivering it. What was learnt about the learner's pauses is kept. */
  reset(): void
  /** What has been heard in this turn so far. */
  current(): string
  /** The longest mid-turn pause seen so far, in ms. */
  longestPause(): number
}

export interface TurnTakerOptions {
  level?: string | null
  /** Called once per turn with the finished text (any closing "that's all" removed). */
  onCommit: (text: string) => void
  now?: () => number
}

export function createTurnTaker(opts: TurnTakerOptions): TurnTaker {
  const now = opts.now ?? (() => Date.now())
  let text = ''
  let lastChange = 0
  let turnStart = 0
  let longest = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let committed = false

  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null }
  const commit = () => {
    clear()
    if (committed) return
    const t = withoutDonePhrase(text)
    if (!t.trim()) return
    committed = true
    opts.onCommit(t)
  }
  const schedule = () => {
    clear()
    const sinceStart = now() - turnStart
    const wait = Math.min(silenceBeforeEnd(text, { level: opts.level, longestPauseMs: longest }), Math.max(0, MAX_TURN_MS - sinceStart))
    timer = setTimeout(commit, wait)
  }
  return {
    update(next) {
      const t = next.trim()
      if (committed || !t || t === text) return
      const at = now()
      if (text === '') turnStart = at
      else if (at - lastChange >= PAUSE_THRESHOLD_MS) longest = Math.min(MAX_WAIT_MS, Math.max(longest, at - lastChange))
      text = t
      lastChange = at
      schedule()
    },
    finishNow() { commit() },
    reset() { clear(); text = ''; committed = false; lastChange = 0; turnStart = 0 },
    current: () => text,
    longestPause: () => longest,
  }
}
