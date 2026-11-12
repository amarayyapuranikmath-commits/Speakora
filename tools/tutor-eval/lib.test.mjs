// Run with: node --test tools/tutor-eval/lib.test.mjs   (no network, no provider quota)
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Pacer, computeGapMs, emptyState, findDuplicateSentences, loadState, parseArgs, parseRetryAfter, pendingScenarios, saveState } from './lib.mjs'

test('the gap respects the stricter of the request and token limits', () => {
  assert.equal(computeGapMs({ rpm: 30, tpm: 100000, tokensPerRequest: 1000 }), 2000) // requests per minute is the limit
  assert.equal(computeGapMs({ rpm: 30, tpm: 8000, tokensPerRequest: 1800 }), 13500) // tokens per minute is the limit
  assert.equal(computeGapMs({ rpm: 5, tpm: 1_000_000, tokensPerRequest: 100 }), 12000)
  assert.equal(computeGapMs({ gapMs: 4321 }), 4321) // an explicit gap wins
  assert.equal(computeGapMs({ gapMs: 0 }), 0)
})

test('Retry-After is read as whole seconds, rounded up, or an HTTP date', () => {
  assert.equal(parseRetryAfter('12'), 12)
  assert.equal(parseRetryAfter('7.2'), 8)
  assert.equal(parseRetryAfter(' 0 '), 0)
  assert.equal(parseRetryAfter(null), null)
  assert.equal(parseRetryAfter(''), null)
  assert.equal(parseRetryAfter('soon'), null)
  assert.equal(parseRetryAfter('-5'), null)
  const now = Date.parse('2026-11-10T12:00:00Z')
  assert.equal(parseRetryAfter('Tue, 10 Nov 2026 12:00:30 GMT', now), 30)
})

test('the pacer spaces requests out and slows down when told to', async () => {
  let t = 0
  const slept = []
  const p = new Pacer(10_000, { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms } })
  await p.beforeRequest() // first request: no wait
  t += 3000 // the request itself took 3 s
  await p.beforeRequest()
  assert.deepEqual(slept, [7000]) // only the remaining 7 s
  t += 20_000 // a long pause: no extra wait needed
  await p.beforeRequest()
  assert.deepEqual(slept, [7000])
  p.slowDown()
  assert.equal(p.gapMs, 15_000)
  for (let i = 0; i < 10; i++) p.slowDown()
  assert.equal(p.gapMs, 60_000) // capped
})

test('a repeated example is found however it is formatted', () => {
  const reply = 'Give up means stop trying.\n- "She gave up smoking last year."\n- "He never gives up."\n\nFor example: She gave up smoking last year!\nTry one yourself.'
  assert.deepEqual(findDuplicateSentences(reply), ['she gave up smoking last year'])
  assert.deepEqual(findDuplicateSentences('One short line. Another different line about verbs today.'), [])
  assert.deepEqual(findDuplicateSentences('Too short. Too short.'), []) // fragments under four words are not examples
})

test('state survives a restart, skips finished scenarios and can redo one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-eval-'))
  const path = join(dir, 'state.json')
  assert.deepEqual(loadState(path), emptyState())
  const state = emptyState()
  state.account = { email: 'tutor.1@example.com', password: 'x' }
  state.scenarios.free = { done: true, checks: [], transcript: [] }
  saveState(path, state)
  const again = loadState(path)
  assert.equal(again.account.email, 'tutor.1@example.com')
  const all = [{ id: 'free' }, { id: 'grammar' }, { id: 'roleplay' }]
  assert.deepEqual(pendingScenarios(all, again).map((s) => s.id), ['grammar', 'roleplay'])
  assert.deepEqual(pendingScenarios(all, again, { only: ['roleplay'] }).map((s) => s.id), ['roleplay'])
  assert.deepEqual(pendingScenarios(all, again, { redo: ['free'] }).map((s) => s.id), ['free']) // redo runs only that one
  assert.equal(again.scenarios.free, undefined) // forgotten by redo
})

test('a damaged or foreign state file is ignored instead of crashing the run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-eval-'))
  const path = join(dir, 'state.json')
  writeFileSync(path, '{ not json')
  assert.deepEqual(loadState(path), emptyState())
  writeFileSync(path, JSON.stringify({ version: 99, scenarios: {} }))
  assert.deepEqual(loadState(path), emptyState())
})

test('saving leaves no temporary file behind and writes complete JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-eval-'))
  const path = join(dir, 'state.json')
  saveState(path, emptyState())
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, 1)
  assert.throws(() => readFileSync(path + '.tmp'))
})

test('command line flags', () => {
  assert.deepEqual(parseArgs(['--only=a,b', '--redo=c', '--dry-run']), { only: ['a', 'b'], redo: ['c'], reset: false, report: false, dryRun: true })
  assert.deepEqual(parseArgs(['--reset', '--report']), { only: [], redo: [], reset: true, report: true, dryRun: false })
})

test('a "mistake" that is identical to its correction is found, curly quotes included', async () => {
  const { repeatedQuotes, plain } = await import('./lib.mjs')
  assert.deepEqual(repeatedQuotes('Learners often say *“I gave up smoking”* but the correct form is *“I gave up smoking”*.'), ['i gave up smoking'])
  assert.deepEqual(repeatedQuotes('Wrong: "He give up." Right: "He gave up."'), [])
  assert.deepEqual(repeatedQuotes('Say "up" and "up".'), []) // single words are not examples
  assert.equal(plain('I can’t hear “you”'), 'I can\'t hear "you"')
})

test('sentence length is measured the way a reader sees sentences (headings and list lines do not glue together)', async () => {
  const { avgSentenceWords, readerSentences } = await import('./lib.mjs')
  const reply = '**reluctant** – *not wanting to do something; feeling hesitant or unwilling.*\n\n**Example:**  \nShe was **reluctant** to ask for help because she didn’t want to seem incompetent.\n\n**Natural conversation line:**  \n*“I’m a bit **reluctant** to try sushi, but I’ll give it a chance.”*\n\nNow it’s your turn – please write a sentence using the word **reluctant**. I’ll help you correct it if needed.'
  const avg = avgSentenceWords(reply)
  assert.ok(avg > 6 && avg < 14, `a simple reply averages about 10 words per sentence, got ${avg.toFixed(1)}`)
  assert.equal(readerSentences('One two three.\nFour five\n\nSix seven eight nine.').length, 3)
  assert.equal(avgSentenceWords(''), 0)
  // genuinely long sentences are still measured as long
  assert.ok(avgSentenceWords('This sentence deliberately keeps going with many many many words so that it is clearly longer than any learner at this level should be given in one go.') > 25)
})
