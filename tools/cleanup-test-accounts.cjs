// Local development only. Run from the repository root: node tools/cleanup-test-accounts.cjs  (set PSQL to your psql path if different)
// Removes only the throwaway accounts that the end-to-end tests create: first name, a dot, digits, @example.com.
// The pattern is deliberately narrow so a real account can never match it.
const { execFileSync } = require('child_process')
const { readFileSync } = require('fs')
const password = readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8').match(/^DB_PASSWORD=([^\r\n]*)$/m)[1]
const psql = process.env.PSQL || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe'
const run = (sql) => execFileSync(psql, ['-U', 'esp_app', '-h', 'localhost', '-d', 'english_speaking', '-w', '-tA', '-c', sql], { env: { ...process.env, PGPASSWORD: password } }).toString().trim()
const where = "email ~ '^(alice|bob|lena|vera|tara|toni|live|mm|turn|smoke|tutor|tour|admintour)\\.[0-9]+@example\\.com$'"
console.log('matching accounts:', run(`select count(*) from users where ${where}`))
console.log('real account untouched check (not matched):', run("select count(*) from users where email = 'protected.account@example.invalid'"))
// calls both of whose participants are test accounts are removed first (call_sessions has no cascade from users)
run(`delete from call_sessions where id in (select call_id from call_participants group by call_id having bool_and(user_id in (select id from users where ${where})))`)
run(`delete from users where ${where}`)
console.log('remaining test-pattern accounts:', run(`select count(*) from users where ${where}`))
console.log('total users now:', run('select count(*) from users'))
