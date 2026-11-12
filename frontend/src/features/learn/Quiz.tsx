import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Alert } from '../../components/ui/feedback'
import { api } from '../../lib/api'
import type { AnswerIn, CheckResult, Outcome, QuestionView } from './learnApi'

const field = 'mt-3 block w-full rounded-control border border-field bg-surface px-3 py-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'

/** What the learner's match or word-order answer looked like, for the result list. */
export const readableAnswer = (a: string) => a.split('||').join('; ').split('=>').join(' = ')

/**
 * Word order: tap the words in the order of the sentence. Tap a word in the sentence to take it back. The answer is the sentence the learner built,
 * so it is graded on the whole sentence by the server.
 */
function ReorderField({ q, index, value, onChange, disabled }: { q: QuestionView; index: number; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const words = q.words ?? []
  const [picked, setPicked] = useState<number[]>([])
  // When the parent clears the answer (a new attempt), start again. Done while rendering, not in an effect, so there is no extra render.
  const [seen, setSeen] = useState(value)
  if (value !== seen) { setSeen(value); if (value === '') setPicked([]) }
  const set = (next: number[]) => { setPicked(next); onChange(next.map((i) => words[i]).join(' ')) }
  const free = words.map((w, i) => ({ w, i })).filter(({ i }) => !picked.includes(i))
  const chip = 'rounded-control border px-3 py-1.5 text-sm font-medium disabled:opacity-50'
  return (
    <fieldset className="rounded-panel border border-line bg-surface p-4" disabled={disabled}>
      <legend className="px-1 text-subheading">{index + 1}. {q.prompt}</legend>
      <div className="mt-2 flex min-h-12 flex-wrap items-center gap-2 rounded-control border border-dashed border-line-strong p-2" aria-label="Your sentence">
        {picked.length === 0 && <span className="text-sm text-muted">Tap the words below in order.</span>}
        {picked.map((wi, n) => (
          <button key={`${wi}-${n}`} type="button" onClick={() => set(picked.filter((_, k) => k !== n))} className={`${chip} border-accent bg-accent-soft`} aria-label={`Remove ${words[wi]}`}>{words[wi]}</button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Words to use">
        {free.map(({ w, i }) => (
          <button key={i} type="button" onClick={() => set([...picked, i])} className={`${chip} border-line-strong hover:bg-black/5`}>{w}</button>
        ))}
        {picked.length > 0 && <button type="button" onClick={() => set([])} className="px-2 text-sm font-medium text-muted hover:text-ink">Clear</button>}
      </div>
    </fieldset>
  )
}

/** Matching: tap a word, then tap its meaning. The answer is the list of pairs; the server decides whether every pair is right. */
function MatchField({ q, index, value, onChange, disabled }: { q: QuestionView; index: number; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const left = q.left ?? [], right = q.right ?? []
  const [active, setActive] = useState<string | null>(null)
  const pairs = new Map<string, string>(value ? value.split('||').map((p) => p.split('=>') as [string, string]) : [])
  const [seen, setSeen] = useState(value)
  if (value !== seen) { setSeen(value); if (value === '') setActive(null) }
  const write = (m: Map<string, string>) => onChange([...m.entries()].map(([l, r]) => `${l}=>${r}`).join('||'))
  function choose(meaning: string) {
    if (!active) return
    const next = new Map(pairs)
    for (const [l, r] of next) if (r === meaning) next.delete(l) // a meaning goes with one word
    next.set(active, meaning)
    write(next)
    setActive(null)
  }
  const used = new Set(pairs.values())
  return (
    <fieldset className="rounded-panel border border-line bg-surface p-4" disabled={disabled}>
      <legend className="px-1 text-subheading">{index + 1}. {q.prompt}</legend>
      <p className="mt-1 text-sm text-muted">Tap a word, then tap the meaning that goes with it.</p>
      <ul className="mt-3 space-y-2" aria-label="Words">
        {left.map((l) => (
          <li key={l}>
            <button type="button" onClick={() => setActive(active === l ? null : l)} aria-pressed={active === l}
              className={`w-full rounded-control border px-3 py-2 text-left ${active === l ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-black/5'}`}>
              <span className="font-medium">{l}</span>
              <span className="block text-sm text-muted">{pairs.get(l) ?? 'not matched yet'}</span>
            </button>
          </li>
        ))}
      </ul>
      <ul className="mt-4 space-y-2" aria-label="Meanings">
        {right.map((r) => (
          <li key={r}>
            <button type="button" onClick={() => choose(r)} disabled={!active} className={`w-full rounded-control border border-line px-3 py-2 text-left text-sm ${used.has(r) ? 'bg-black/5 text-muted' : ''} disabled:cursor-default`}>{r}</button>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}

/** One question: choose an option, type the missing word or the corrected sentence, put words in order, or match words with meanings. */
export function QuestionField({ q, index, value, onChange, disabled }: { q: QuestionView; index: number; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const inputId = `q-${q.id}`
  if (q.type === 'choice') {
    return (
      <fieldset className="rounded-panel border border-line bg-surface p-4" disabled={disabled}>
        <legend className="px-1 text-subheading">{index + 1}. {q.prompt}</legend>
        <div className="mt-2 space-y-2">
          {(q.options ?? []).map((o) => (
            <label key={o} className="flex cursor-pointer items-start gap-3 rounded-control px-2 py-1.5 hover:bg-black/5">
              <input type="radio" name={inputId} value={o} checked={value === o} onChange={() => onChange(o)} className="mt-1.5 size-4 accent-accent" />
              <span>{o}</span>
            </label>
          ))}
        </div>
      </fieldset>
    )
  }
  if (q.type === 'reorder') return <ReorderField q={q} index={index} value={value} onChange={onChange} disabled={disabled} />
  if (q.type === 'match') return <MatchField q={q} index={index} value={value} onChange={onChange} disabled={disabled} />
  return (
    <div className="rounded-panel border border-line bg-surface p-4">
      <label htmlFor={inputId} className="block text-subheading">{index + 1}. {q.prompt}</label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize={q.type === 'correct' ? 'sentences' : 'none'}
        spellCheck={false}
        maxLength={300}
        placeholder={q.type === 'correct' ? 'Write the whole corrected sentence' : undefined}
        className={field}
      />
    </div>
  )
}

/**
 * A set of questions with one Submit button. The server grades it and returns what was right, what the correct answer was and why,
 * so the result shown is the real, recorded one.
 */
export function QuizRunner({ questions, submit, passText, children }: {
  questions: QuestionView[]
  submit: (answers: AnswerIn[]) => Promise<Outcome>
  passText?: string
  children?: (outcome: Outcome) => React.ReactNode
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function send() {
    setBusy(true)
    setFailed(false)
    try {
      setOutcome(await submit(questions.map((q) => ({ id: q.id, answer: answers[q.id] ?? '' }))))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (outcome) {
    const byId = new Map(outcome.results.map((r) => [r.id, r]))
    return (
      <div className="space-y-4">
        <div role="status" className={`rounded-panel border p-4 ${outcome.passed ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface'}`}>
          <p className="text-heading">You scored {outcome.correct} out of {outcome.total} ({outcome.percent}%)</p>
          <p className="mt-1 text-muted">{outcome.passed ? (passText ?? 'Well done. That is a pass.') : 'Not a pass yet. Read the explanations below and try again.'}</p>
        </div>
        <ol className="space-y-3">
          {questions.map((q, i) => {
            const r = byId.get(q.id)
            if (!r) return null
            return (
              <li key={q.id} className="rounded-panel border border-line bg-surface p-4">
                <p className="font-medium">{i + 1}. {q.prompt}</p>
                <p className={`mt-2 text-sm font-medium ${r.correct ? 'text-success' : 'text-danger'}`}>{r.correct ? 'Correct' : 'Not quite'}</p>
                {!r.correct && (
                  <p className="mt-1 text-sm">Your answer: {r.yourAnswer ? readableAnswer(r.yourAnswer) : 'no answer'}. Correct answer: <strong>{readableAnswer(r.correctAnswer)}</strong></p>
                )}
                <p className="mt-1 text-sm text-muted">{r.why}</p>
              </li>
            )
          })}
        </ol>
        {children?.(outcome)}
        <Button variant="secondary" onClick={() => { setOutcome(null); setAnswers({}) }}>Try again</Button>
      </div>
    )
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void send() }}>
      {questions.map((q, i) => (
        <QuestionField key={q.id} q={q} index={i} value={answers[q.id] ?? ''} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} disabled={busy} />
      ))}
      {failed && <Alert>That did not go through. Check your connection and try again.</Alert>}
      <Button type="submit" loading={busy}>Submit answers</Button>
    </form>
  )
}

/** Practice exercises: check one answer at a time and see the explanation straight away. Nothing is recorded. */
export function PracticeList({ questions }: { questions: QuestionView[] }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Record<string, CheckResult>>({})
  const [busy, setBusy] = useState<string | null>(null)

  async function check(q: QuestionView) {
    setBusy(q.id)
    try {
      const r = await api<CheckResult>('/api/learn/check', { method: 'POST', body: { id: q.id, answer: answers[q.id] ?? '' } })
      setFeedback((f) => ({ ...f, [q.id]: r }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <ol className="space-y-4">
      {questions.map((q, i) => {
        const f = feedback[q.id]
        return (
          <li key={q.id}>
            <QuestionField q={q} index={i} value={answers[q.id] ?? ''} onChange={(v) => { setAnswers((a) => ({ ...a, [q.id]: v })); setFeedback(({ [q.id]: _gone, ...rest }) => rest) }} />
            <div className="mt-2 flex items-start gap-3">
              <Button variant="secondary" onClick={() => void check(q)} loading={busy === q.id} disabled={!(answers[q.id] ?? '').trim()} aria-label={`Check answer ${i + 1}`}>Check</Button>
              {f && (
                <p role="status" className="pt-2 text-sm">
                  <span className={`font-medium ${f.correct ? 'text-success' : 'text-danger'}`}>{f.correct ? 'Correct. ' : 'Not quite. '}</span>
                  {!f.correct && <>The answer is <strong>{f.correctAnswer}</strong>. </>}
                  <span className="text-muted">{f.why}</span>
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
