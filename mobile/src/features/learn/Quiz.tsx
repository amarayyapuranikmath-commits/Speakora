import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { api } from '../../lib/api'
import { Alert, Button, Input } from '../../ui/components'
import { colors, space, type } from '../../ui/theme'
import type { AnswerIn, CheckResult, Outcome, QuestionView } from './learnApi'

/** What the learner's match answer looked like, for the result list. */
export const readableAnswer = (a: string) => a.split('||').join('; ').split('=>').join(' = ')

const chip = (selected: boolean) => ({
  minHeight: 44, justifyContent: 'center' as const, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: selected ? colors.accent : colors.lineStrong, backgroundColor: selected ? colors.accentSoft : colors.surface,
})

/** Word order: tap the words in the order of the sentence; tap a word in the sentence to take it back. Graded on the whole sentence by the server. */
function ReorderField({ q, value, onChange, disabled }: { q: QuestionView; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const words = q.words ?? []
  const [picked, setPicked] = useState<number[]>([])
  useEffect(() => { if (value === '') setPicked([]) }, [value])
  const set = (next: number[]) => { setPicked(next); onChange(next.map((i) => words[i]).join(' ')) }
  const free = words.map((w, i) => ({ w, i })).filter(({ i }) => !picked.includes(i))
  return (
    <View style={{ marginTop: space.sm, gap: space.md }}>
      <View accessibilityLabel="Your sentence" style={{ minHeight: 56, flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, borderRadius: 8, alignItems: 'center' }}>
        {picked.length === 0 ? <Text style={type.small}>Tap the words below in order.</Text> : null}
        {picked.map((wi, n) => (
          <Pressable key={`${wi}-${n}`} accessibilityRole="button" accessibilityLabel={`Remove ${words[wi]}`} disabled={disabled} onPress={() => set(picked.filter((_, k) => k !== n))} style={chip(true)}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{words[wi]}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {free.map(({ w, i }) => (
          <Pressable key={i} accessibilityRole="button" accessibilityLabel={w} disabled={disabled} onPress={() => set([...picked, i])} style={chip(false)}>
            <Text style={{ fontSize: 16, color: colors.ink }}>{w}</Text>
          </Pressable>
        ))}
        {picked.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear the sentence" disabled={disabled} onPress={() => set([])} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.muted }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

/** Matching: tap a word, then tap its meaning. The answer is the list of pairs; the server decides whether every pair is right. */
function MatchField({ q, value, onChange, disabled }: { q: QuestionView; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const left = q.left ?? [], right = q.right ?? []
  const [active, setActive] = useState<string | null>(null)
  const pairs = new Map<string, string>(value ? value.split('||').map((p) => p.split('=>') as [string, string]) : [])
  useEffect(() => { if (value === '') setActive(null) }, [value])
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
    <View style={{ marginTop: space.sm, gap: space.md }}>
      <Text style={type.small}>Tap a word, then tap the meaning that goes with it.</Text>
      <View accessibilityLabel="Words" style={{ gap: 8 }}>
        {left.map((l) => (
          <Pressable key={l} accessibilityRole="button" accessibilityLabel={`Word ${l}`} accessibilityState={{ selected: active === l, disabled }} disabled={disabled} onPress={() => setActive(active === l ? null : l)} style={[chip(active === l), { justifyContent: 'center', paddingVertical: 8 }]}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{l}</Text>
            <Text style={type.small}>{pairs.get(l) ?? 'not matched yet'}</Text>
          </Pressable>
        ))}
      </View>
      <View accessibilityLabel="Meanings" style={{ gap: 8 }}>
        {right.map((r) => (
          <Pressable key={r} accessibilityRole="button" accessibilityLabel={`Meaning ${r}`} disabled={disabled || !active} onPress={() => choose(r)} style={[chip(false), { paddingVertical: 8, backgroundColor: used.has(r) ? 'rgba(0,0,0,0.05)' : colors.surface }]}>
            <Text style={{ fontSize: 15, color: used.has(r) ? colors.muted : colors.ink }}>{r}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

/** One question: choose an option, type the missing word or the corrected sentence, put words in order, or match words with meanings. */
export function QuestionField({ q, index, value, onChange, disabled }: { q: QuestionView; index: number; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <View style={{ paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.line }}>
      <Text accessibilityRole="header" style={type.subheading}>{index + 1}. {q.prompt}</Text>
      {q.type === 'choice' ? (
        <View style={{ marginTop: space.sm }} accessibilityRole="radiogroup">
          {(q.options ?? []).map((o) => {
            const selected = value === o
            return (
              <Pressable
                key={o}
                accessibilityRole="radio"
                accessibilityLabel={o}
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                onPress={() => onChange(o)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }}
              >
                <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? colors.accent : colors.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
                  {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} /> : null}
                </View>
                <Text style={{ flex: 1, fontSize: 16, color: colors.ink }}>{o}</Text>
              </Pressable>
            )
          })}
        </View>
      ) : q.type === 'reorder' ? (
        <ReorderField q={q} value={value} onChange={onChange} disabled={disabled} />
      ) : q.type === 'match' ? (
        <MatchField q={q} value={value} onChange={onChange} disabled={disabled} />
      ) : (
        <Input
          accessibilityLabel={`Answer ${index + 1}`}
          value={value}
          onChangeText={onChange}
          editable={!disabled}
          autoCapitalize={q.type === 'correct' ? 'sentences' : 'none'}
          autoCorrect={false}
          maxLength={300}
          placeholder={q.type === 'correct' ? 'Write the whole corrected sentence' : undefined}
          style={{ marginTop: space.md, minHeight: 48, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 8, paddingHorizontal: 12, fontSize: 16, color: colors.ink, backgroundColor: colors.surface }}
        />
      )}
    </View>
  )
}

/** A set of questions with one Submit button; the server grades it and the real, recorded result is shown. */
export function QuizRunner({ questions, submit, passText, after }: {
  questions: QuestionView[]
  submit: (answers: AnswerIn[]) => Promise<Outcome>
  passText?: string
  after?: (outcome: Outcome) => React.ReactNode
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
      <View style={{ gap: space.md }}>
        <View accessibilityLiveRegion="polite" style={{ borderWidth: 1, borderColor: outcome.passed ? colors.accent : colors.line, backgroundColor: outcome.passed ? colors.accentSoft : colors.surface, borderRadius: 12, padding: space.lg }}>
          <Text style={type.heading}>You scored {outcome.correct} out of {outcome.total} ({outcome.percent}%)</Text>
          <Text style={[type.small, { marginTop: 4 }]}>{outcome.passed ? (passText ?? 'Well done. That is a pass.') : 'Not a pass yet. Read the explanations below and try again.'}</Text>
        </View>
        {questions.map((q, i) => {
          const r = byId.get(q.id)
          if (!r) return null
          return (
            <View key={q.id} style={{ paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.line }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{i + 1}. {q.prompt}</Text>
              <Text style={{ marginTop: 6, fontWeight: '600', color: r.correct ? colors.success : colors.danger }}>{r.correct ? 'Correct' : 'Not quite'}</Text>
              {!r.correct ? <Text style={type.small}>Your answer: {r.yourAnswer ? readableAnswer(r.yourAnswer) : 'no answer'}. Correct answer: {readableAnswer(r.correctAnswer)}</Text> : null}
              <Text style={type.small}>{r.why}</Text>
            </View>
          )
        })}
        {after?.(outcome)}
        <Button label="Try again" variant="secondary" onPress={() => { setOutcome(null); setAnswers({}) }} />
      </View>
    )
  }

  return (
    <View style={{ gap: space.md }}>
      {questions.map((q, i) => <QuestionField key={q.id} q={q} index={i} value={answers[q.id] ?? ''} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} disabled={busy} />)}
      {failed ? <Alert>That did not go through. Check your connection and try again.</Alert> : null}
      <Button label="Submit answers" onPress={() => void send()} loading={busy} />
    </View>
  )
}

/** Practice exercises: one answer at a time with instant feedback from the server. Nothing is recorded. */
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
    <View style={{ gap: space.lg }}>
      {questions.map((q, i) => {
        const f = feedback[q.id]
        return (
          <View key={q.id} style={{ gap: space.sm }}>
            <QuestionField q={q} index={i} value={answers[q.id] ?? ''} onChange={(v) => { setAnswers((a) => ({ ...a, [q.id]: v })); setFeedback((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => k !== q.id))) }} />
            <Button label={`Check answer ${i + 1}`} variant="secondary" onPress={() => void check(q)} loading={busy === q.id} disabled={!(answers[q.id] ?? '').trim()} />
            {f ? (
              <Text accessibilityLiveRegion="polite" style={type.small}>
                <Text style={{ fontWeight: '600', color: f.correct ? colors.success : colors.danger }}>{f.correct ? 'Correct. ' : 'Not quite. '}</Text>
                {f.correct ? '' : `The answer is ${f.correctAnswer}. `}{f.why}
              </Text>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}
