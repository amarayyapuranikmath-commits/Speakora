// Runs the real run.mjs against a mock backend: pacing, Retry-After, stopping on a long wait, resuming. No provider quota is used.
// node --test tools/tutor-eval/run.test.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const RUN = fileURLToPath(new URL('./run.mjs', import.meta.url))

/** A backend that behaves like ours for the calls the harness makes. `messages` decides each tutor reply. */
function mockBackend(messages) {
  const log = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      log.push(`${req.method} ${req.url}`)
      const json = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)) }
      if (req.url === '/api/auth/register' || req.url === '/api/auth/login') return json(200, { accessToken: 't' })
      if (req.url === '/api/topics') return json(200, [{ slug: 'travel' }])
      if (req.url === '/api/profile/onboarding') return json(200, {})
      if (req.url === '/api/preferences') return json(200, { aiCoachConsent: false })
      if (req.url === '/api/coach/conversations') return json(200, { id: 'c1' })
      if (req.url.endsWith('/messages')) { log.push('MESSAGE'); return messages(json, log.filter((l) => l === 'MESSAGE').length, JSON.parse(body)) }
      json(404, {})
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, log, base: `http://127.0.0.1:${server.address().port}` })))
}

function run(base, statePath, extra = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUN, '--only=roleplay', ...extra], { env: { ...process.env, EVAL_BASE: base, EVAL_STATE: statePath, EVAL_GAP_MS: '0', ...env } })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const started = Date.now()
    child.on('close', (code) => resolve({ code, out, ms: Date.now() - started }))
  })
}

const reply = (text) => ({ reply: { content: text } })

test('waits exactly the Retry-After it was given, then finishes and saves the scenario', async () => {
  const b = await mockBackend((json, n) => (n === 1
    ? json(429, { code: 'COACH_BUSY', message: 'busy' }, { 'Retry-After': '1' })
    : json(200, reply('Welcome! Here is the menu. What would you like to drink?'))))
  const state = join(mkdtempSync(join(tmpdir(), 'eval-')), 'state.json')
  const r = await run(b.base, state)
  b.server.close()
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /waiting 2 s as the provider asked/)
  assert.ok(r.ms >= 2000, `waited about 2 s, took ${r.ms} ms`)
  assert.equal(b.log.filter((l) => l === 'MESSAGE').length, 2, 'one rejected request and exactly one retry')
  const saved = JSON.parse(readFileSync(state, 'utf8'))
  assert.equal(saved.scenarios.roleplay.done, true)
  assert.equal(saved.account.email.startsWith('tutor.'), true)
})

test('a long wait stops the run cleanly, saves nothing for the unfinished scenario, and a later run resumes', async () => {
  let limited = true
  const b = await mockBackend((json) => (limited
    ? json(429, { code: 'COACH_BUSY', message: 'busy' }, { 'Retry-After': '600' })
    : json(200, reply('Welcome! Here is the menu. Anything to drink?'))))
  const state = join(mkdtempSync(join(tmpdir(), 'eval-')), 'state.json')
  const first = await run(b.base, state)
  assert.equal(first.code, 3, first.out)
  assert.match(first.out, /Run the same command later/)
  assert.equal(b.log.filter((l) => l === 'MESSAGE').length, 1, 'no repeated hits on a limit that has not reset')
  assert.equal(JSON.parse(readFileSync(state, 'utf8')).scenarios.roleplay, undefined)

  limited = false // the limit has reset
  const second = await run(b.base, state)
  assert.equal(second.code, 0, second.out)
  assert.ok(b.log.includes('POST /api/auth/login'), 'the saved account is reused, not a new one registered')
  assert.equal(b.log.filter((x) => x === 'POST /api/auth/register').length, 1)

  const third = await run(b.base, state) // everything is done: nothing is sent
  b.server.close()
  assert.equal(third.code, 0, third.out)
  assert.match(third.out, /nothing, everything is already done/)
  assert.equal(b.log.filter((l) => l === 'MESSAGE').length, 2, 'finished scenarios are not run again')
})

test('the daily allowance stops the run immediately without waiting or retrying', async () => {
  const b = await mockBackend((json) => json(429, { code: 'RATE_LIMITED', message: "You have reached today's chat limit. Try again tomorrow." }))
  const state = join(mkdtempSync(join(tmpdir(), 'eval-')), 'state.json')
  const r = await run(b.base, state)
  b.server.close()
  assert.equal(r.code, 3, r.out)
  assert.match(r.out, /daily allowance/)
  assert.equal(b.log.filter((l) => l === 'MESSAGE').length, 1)
  assert.ok(r.ms < 5000)
})

test('--dry-run and --report send nothing', async () => {
  const b = await mockBackend((json) => json(200, reply('x')))
  const state = join(mkdtempSync(join(tmpdir(), 'eval-')), 'state.json')
  const dry = await run(b.base, state, ['--dry-run'])
  const rep = await run(b.base, state, ['--report'])
  b.server.close()
  assert.equal(dry.code, 0)
  assert.equal(rep.code, 0)
  assert.equal(b.log.length, 0)
  assert.equal(existsSync(state), false)
})
