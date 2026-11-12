import { Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AnchorButton, LinkButton } from '../../components/ui/Button'
import { brand } from '../../config/brand'
import { AndroidAppSection } from './AndroidAppSection'

/*
 * Every statement on this page describes something that exists and has been verified. Learn (grammar, vocabulary, phrasal verbs),
 * Friends and the AI tutor are described here because they are built and were tested end to end; keep it that way: no claims about
 * pronunciation scoring, the AI hearing your voice (the browser turns speech into text), certificates or exam preparation. No statistics, user counts, ratings or
 * testimonials: none exist.
 */

const STEPS = [
  { title: 'Set up your profile', body: 'Tell us your English level, your native language and what you like to talk about. It takes about a minute.' },
  { title: 'Get matched', body: 'We connect you with another learner who is online now, preferring a similar level and shared interests.' },
  { title: 'Talk, then reflect', body: 'Have a one-to-one voice conversation. Afterwards leave feedback and see your speaking time grow.' },
]

const FEATURES = [
  { title: 'Quick Match', body: 'One-to-one voice calls with another learner who is online now, matched by level and interests. Calls are never recorded.' },
  { title: 'AI Coach', body: 'An AI tutor you can talk or type with. It explains, corrects and asks questions. Your conversation is not saved.' },
  { title: 'Learn', body: 'Grammar, vocabulary and phrasal verbs, with a daily plan, practice tests and revision.' },
  { title: 'Friends', body: 'Add people you have spoken with. Only friends can message or call you privately.' },
  { title: 'Progress', body: 'Speaking time, lessons, test scores and streaks, counted from what you actually did.' },
]

const SAFETY = [
  { title: 'Adults only', body: 'Accounts are for people aged 18 and over. Your date of birth is required to register.' },
  { title: 'Never recorded', body: 'Calls are not recorded or stored. Your email address is never shown to your partner.' },
  { title: 'You are in control', body: 'Leave or skip at any time. Block and report anyone from the call screen or your history.' },
]

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="max-w-reading">
          <h2 className="text-title">{title}</h2>
          {children}
        </div>
      </div>
    </section>
  )
}

export function LandingPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pt-20 pb-24 sm:px-8 sm:pt-28 sm:pb-32">
        <div className="max-w-3xl">
          <p className="text-small font-medium text-accent">Voice-only English practice</p>
          <h1 className="mt-5 text-4xl sm:text-display">Speak English with real people.</h1>
          <p className="mt-7 max-w-reading text-body text-muted sm:text-lg">
            {brand.name} connects you with other learners for one-to-one voice calls, and helps you learn with structured lessons and an AI tutor. No scripts, no call recordings.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-4">
            <LinkButton to="/register" size="lg">Start Speaking</LinkButton>
            {brand.androidDownloadUrl && (
              <AnchorButton href={brand.androidDownloadUrl} download rel="noopener" variant="secondary" size="lg">
                <Download className="size-5" aria-hidden /> Download Android app
              </AnchorButton>
            )}
            <Link to="/login" className="rounded-control px-1 py-2 text-small font-medium text-muted hover:text-ink">Log in</Link>
          </div>
          <p className="mt-6 text-small text-subtle">For adults aged 18 and over.</p>
        </div>
      </section>

      <Section id="how-it-works" title="How it works">
        <ol className="mt-12 space-y-10">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-6">
              <span className="w-6 shrink-0 pt-0.5 text-small font-semibold tabular-nums text-accent">0{i + 1}</span>
              <div>
                <h3 className="text-subheading">{s.title}</h3>
                <p className="mt-1.5 text-body text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="features" title="What you can do">
        <ul className="mt-10 divide-y divide-line border-y border-line">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex flex-col gap-1.5 py-6 sm:flex-row sm:gap-10">
              <h3 className="text-subheading sm:w-40 sm:shrink-0">{f.title}</h3>
              <p className="text-body text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <AndroidAppSection />

      <Section id="safety" title="Safety and privacy">
        <p className="mt-4 text-body text-muted">Talking to strangers requires trust. These are the commitments built into the product today.</p>
        <dl className="mt-12 space-y-9">
          {SAFETY.map((f) => (
            <div key={f.title}>
              <dt className="text-subheading">{f.title}</dt>
              <dd className="mt-1.5 text-body text-muted">{f.body}</dd>
            </div>
          ))}
        </dl>
        <Link to="/safety" className="mt-10 inline-block text-small font-medium text-accent hover:underline">Read more about safety and privacy</Link>
      </Section>

      <Section title="Ready for your first conversation?">
        <div className="mt-8">
          <LinkButton to="/register" size="lg">Create an account</LinkButton>
        </div>
      </Section>
    </>
  )
}
