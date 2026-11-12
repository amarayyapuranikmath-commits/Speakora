import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TURN_MS, MAX_WAIT_MS, MIN_WAIT_MS, completenessOf, createTurnTaker, saidDone, silenceBeforeEnd, withoutDonePhrase } from './turn'

describe('what the words say about being finished', () => {
  it('knows a sentence that is clearly unfinished', () => {
    for (const t of ['I went to the market and', 'I think that', 'My name is', 'I want to', 'Yesterday I', 'well um', 'because of the']) {
      expect(completenessOf(t), t).toBe('unfinished')
    }
  })
  it('knows when "is" ends a sentence and when it leaves it open', () => {
    expect(completenessOf('The answer is')).toBe('unfinished')
    expect(completenessOf("I don't know what the answer is")).toBe('unfinished') // can't tell from the words alone: waits a little longer, never cuts in
    expect(completenessOf('I know where it is')).toBe('sentence')
    expect(completenessOf('Yes I do')).not.toBe('unfinished')
    expect(completenessOf('Yes it is')).not.toBe('unfinished')
  })
  it('knows a short answer that stands alone', () => {
    for (const t of ['yes', 'Thank you', 'okay', "I don't know", 'of course']) expect(completenessOf(t), t).toBe('complete-alone')
  })
  it('treats one or two other words as probably the start of something', () => {
    expect(completenessOf('Hello teacher')).toBe('short')
    expect(completenessOf('my family')).toBe('short')
  })
  it('treats an ordinary sentence as complete-looking', () => {
    expect(completenessOf('I live in Bangalore with my family')).toBe('sentence')
    expect(completenessOf('What is the difference between do and does')).toBe('sentence')
  })
  it('does not call a sentence unfinished when it is punctuated as finished', () => {
    expect(completenessOf('I will go to.')).toBe('sentence')
  })
  it('recognises an explicit end of turn only when something was said before it', () => {
    expect(saidDone("I live in Mysore and I like cricket. That's all")).toBe(true)
    expect(saidDone('I am done.')).toBe(false)
    expect(saidDone('I live in Mysore')).toBe(false)
    expect(saidDone('That’s all')).toBe(false)
    expect(withoutDonePhrase("I like tea, that's all.")).toBe('I like tea,')
    expect(withoutDonePhrase('that is all')).toBe('that is all')
  })
})

describe('how long to wait after the last word', () => {
  it('waits much longer when the sentence is obviously unfinished than when it is complete', () => {
    const unfinished = silenceBeforeEnd('I went to the market and', { level: 'B2' })
    const complete = silenceBeforeEnd('I went to the market yesterday morning', { level: 'B2' })
    expect(unfinished).toBeGreaterThan(complete + 1500)
    expect(complete).toBeGreaterThanOrEqual(1500) // never the one-second cut-off that interrupted learners
  })
  it('answers a plain "yes" faster, but never instantly', () => {
    const t = silenceBeforeEnd('yes', { level: 'B2' })
    expect(t).toBeGreaterThanOrEqual(MIN_WAIT_MS)
    expect(t).toBeLessThan(silenceBeforeEnd('I went to the market yesterday morning', { level: 'B2' }))
  })
  it('gives beginners and unknown levels more time than advanced learners', () => {
    const sentence = 'I like to watch films in the evening'
    expect(silenceBeforeEnd(sentence, { level: 'A1' })).toBeGreaterThan(silenceBeforeEnd(sentence, { level: 'B1' }))
    expect(silenceBeforeEnd(sentence, { level: 'B1' })).toBeGreaterThan(silenceBeforeEnd(sentence, { level: 'C1' }))
    expect(silenceBeforeEnd(sentence, {})).toBeGreaterThan(silenceBeforeEnd(sentence, { level: 'C1' }))
  })
  it('never waits less than the learner has already paused inside a turn, and never more than the cap', () => {
    const sentence = 'I like to watch films in the evening'
    expect(silenceBeforeEnd(sentence, { level: 'B2', longestPauseMs: 3000 })).toBeGreaterThanOrEqual(3750)
    expect(silenceBeforeEnd(sentence, { level: 'A1', longestPauseMs: 60_000 })).toBe(MAX_WAIT_MS)
  })
  it('ends an explicit "that\'s all" almost at once', () => {
    expect(silenceBeforeEnd("I like tea and coffee that's all")).toBeLessThan(500)
  })
})

describe('the turn taker', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
  afterEach(() => vi.useRealTimers())

  const taker = (level: string | null = 'B1') => {
    const done: string[] = []
    return { done, t: createTurnTaker({ level, onCommit: (x) => done.push(x) }) }
  }

  it('does not answer after a one second thinking pause in the middle of a sentence', () => {
    const { done, t } = taker()
    t.update('I think the best way to learn English is')
    vi.advanceTimersByTime(1000)
    expect(done).toEqual([])
    vi.advanceTimersByTime(2000)
    expect(done).toEqual([])
    vi.advanceTimersByTime(2000)
    expect(done).toEqual(['I think the best way to learn English is'])
  })

  it('keeps waiting while new words keep arriving, and finishes after the silence once they stop', () => {
    const { done, t } = taker()
    let spoken = ''
    for (const w of ['I', 'went', 'to', 'the', 'market', 'with', 'my', 'sister', 'yesterday']) {
      spoken = (spoken + ' ' + w).trim()
      t.update(spoken)
      vi.advanceTimersByTime(400)
    }
    expect(done).toEqual([])
    vi.advanceTimersByTime(3000)
    expect(done).toEqual(['I went to the market with my sister yesterday'])
  })

  it('does not wait longer than necessary once the learner has clearly finished', () => {
    const { done, t } = taker('B2')
    t.update('I live in Bangalore and I work as a teacher')
    vi.advanceTimersByTime(2600)
    expect(done).toEqual(['I live in Bangalore and I work as a teacher'])
  })

  it('learns the learner\'s own pauses: after a long mid-sentence pause it waits longer for the next sentence', () => {
    const { done, t } = taker('B2')
    t.update('I like cooking')
    vi.advanceTimersByTime(2000) // a pause long enough to be noticed, and shorter than the wait for a three word start
    expect(done).toEqual([])
    t.update('I like cooking especially for my family on Sundays')
    expect(t.longestPause()).toBeGreaterThanOrEqual(2000)
    vi.advanceTimersByTime(2000)
    expect(done).toEqual([]) // an ordinary sentence would have ended after 2.3 s; this learner pauses, so it waits
    vi.advanceTimersByTime(800)
    expect(done).toHaveLength(1)
  })

  it('delivers at once when the learner finishes the turn with the Done control', () => {
    const { done, t } = taker()
    t.update('I want to tell you about my')
    t.finishNow()
    expect(done).toEqual(['I want to tell you about my'])
    vi.advanceTimersByTime(10_000)
    expect(done).toHaveLength(1) // only once
  })

  it('nothing to deliver, nothing delivered', () => {
    const { done, t } = taker()
    t.finishNow()
    t.update('   ')
    vi.advanceTimersByTime(20_000)
    expect(done).toEqual([])
  })

  it('removes a spoken "that\'s all" and ends quickly', () => {
    const { done, t } = taker()
    t.update("I like football that's all")
    vi.advanceTimersByTime(400)
    expect(done).toEqual(['I like football'])
  })

  it('never lets a turn run for ever', () => {
    const { done, t } = taker('A1')
    let spoken = 'one'
    for (let ms = 0; ms < MAX_TURN_MS + 10_000 && done.length === 0; ms += 1000) {
      spoken += ' word'
      t.update(spoken)
      vi.advanceTimersByTime(1000)
    }
    expect(done).toHaveLength(1)
  })

  it('a reset forgets the turn but keeps what it learnt about the pauses', () => {
    const { done, t } = taker('B2')
    t.update('I like cooking')
    vi.advanceTimersByTime(2000)
    t.update('I like cooking very much indeed')
    t.reset()
    vi.advanceTimersByTime(10_000)
    expect(done).toEqual([])
    expect(t.current()).toBe('')
    expect(t.longestPause()).toBeGreaterThanOrEqual(2000)
    t.update('Another sentence about my day today')
    vi.advanceTimersByTime(2000)
    expect(done).toEqual([]) // still patient
  })
})
