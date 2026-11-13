// Creates ONE throwaway measurement account on a local backend and marks it verified and onboarded (there is no mail server to verify it with).
// Usage: PERF_PASSWORD=<choose one> node tools/perf/prepare-user.cjs [backend]          prints the email only (the password is the PERF_PASSWORD you set); remove it with: node tools/perf/prepare-user.cjs --delete <email>
const { execFileSync } = require('child_process')
const { readFileSync } = require('fs')
const path = require('path')
const env = readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8')
const pw = env.match(/^DB_PASSWORD=([^\r\n]*)$/m)[1]
// PERF_DB selects the database; measurements run against english_speaking_test so that nothing touches the real data
const db = process.env.PERF_DB || 'english_speaking'
const psql = process.env.PSQL || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe'
const sql = (q) => execFileSync(psql, ['-U', 'esp_app', '-h', 'localhost', '-d', db, '-w', '-tA', '-c', q], { env: { ...process.env, PGPASSWORD: pw } }).toString().trim()

;(async () => {
  if (process.argv[2] === '--delete') {
    const email = process.argv[3]
    if (!/^perf\.\d+@example\.com$/.test(email)) throw new Error('only perf.<digits>@example.com accounts are removed here')
    sql(`delete from users where email = '${email}'`)
    console.log('deleted', email)
    return
  }
  if (process.argv[2] === '--seed-friends') {
    // N throwaway friends (verified, onboarded, 3 unread messages each) so a friends list of realistic size can be measured. Removed again by --cleanup.
    const email = process.argv[3], count = Number(process.argv[4] || 40)
    if (!/^perf\.\d+@example\.com$/.test(email) || !(count > 0 && count <= 500)) throw new Error('usage: --seed-friends perf.<digits>@example.com <1..500>')
    const file = path.join(require('os').tmpdir(), 'perf-seed-friends.sql')
    require('fs').writeFileSync(file, `
create temp table seed as select gen_random_uuid() as id, g, (select id from users where email = '${email}') as me from generate_series(1, ${count}) g;
insert into users(id, email, password_hash, email_verified, date_of_birth, onboarding_completed)
  select s.id, 'perf.' || (extract(epoch from clock_timestamp()) * 1000)::bigint || lpad(s.g::text, 3, '0') || '@example.com', (select password_hash from users where email = '${email}'), true, date '1990-01-01', true from seed s;
insert into user_profiles(user_id, display_name, country, time_zone, native_language, english_level, learning_goals, interests)
  select s.id, 'Friend ' || s.g, 'GB', 'Europe/London', 'es', 'B1', '{}', '{travel}' from seed s;
insert into user_preferences(user_id) select s.id from seed s;
insert into friendships(user_a, user_b, created_at) select least(s.me, s.id), greatest(s.me, s.id), now() - s.g * interval '1 hour' from seed s;
insert into direct_messages(id, user_a, user_b, sender_id, body, created_at)
  select gen_random_uuid(), least(s.me, s.id), greatest(s.me, s.id), s.id, 'hello ' || k, now() - (k + s.g) * interval '1 minute' from seed s, generate_series(1, 3) k;
`)
    execFileSync(psql, ['-U', 'esp_app', '-h', 'localhost', '-d', db, '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { env: { ...process.env, PGPASSWORD: pw } })
    console.log('seeded', count, 'friends for', email)
    return
  }
  if (process.argv[2] === '--cleanup') {
    // every throwaway account this tool ever made (cascades to friendships, messages, tokens)
    const who = "select id from users where email ~ '^perf[.][0-9]+@example[.]com$'"
    sql(`delete from call_sessions where id in (select call_id from call_participants where user_id in (${who}))`)
    console.log('deleted users:', sql(`with d as (delete from users where id in (${who}) returning 1) select count(*) from d`))
    return
  }
  const base = process.argv[2] || 'http://localhost:8090'
  const email = `perf.${Date.now()}@example.com`
  const password = process.env.PERF_PASSWORD
  if (!password || password.length < 8) throw new Error('set PERF_PASSWORD (at least 8 characters, with a letter and a digit) for the throwaway account; it is read from the environment and never stored in this file')
  const res = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' }, body: JSON.stringify({ email, password, displayName: 'Perf Tester', dateOfBirth: '1990-05-01' }) })
  if (res.status !== 201) throw new Error('register failed: ' + res.status)
  const token = (await res.json()).accessToken
  sql(`update users set email_verified = true where email = '${email}'`)
  const profile = await fetch(base + '/api/profile/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile', Authorization: `Bearer ${token}` }, body: JSON.stringify({ displayName: 'Perf Tester', country: 'GB', timeZone: 'Europe/London', nativeLanguage: 'es', englishLevel: 'B1', learningGoals: ['fluency'], interests: ['travel'], onboardingCompleted: true }) })
  console.log(JSON.stringify({ email, profileStatus: profile.status }))
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
