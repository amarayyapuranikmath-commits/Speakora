import { brand } from '../../config/brand'

const SECTIONS = [
  {
    title: 'Who can use the service',
    body: [
      'Random voice conversations with strangers are available to adults aged 18 and over only. You confirm your date of birth when you register, and accounts that do not meet the requirement cannot be created.',
    ],
  },
  {
    title: 'What we do not do with your calls',
    body: [
      'Calls are not recorded, and we do not store audio. Voice travels directly between you and your partner using WebRTC; our servers only help the two browsers find each other.',
      'The AI coach is optional and asks for your consent first. It only ever receives text you type, or text your own browser recognises when you choose voice input. It never receives your calls. Your coach conversation is not saved: it is kept only in memory on your device while you talk and is cleared when you end the session or leave the page. No conversation history, voice transcript or audio is stored in our database, and we do not log what you say. To write replies, the text you send is processed by our AI provider, which has its own handling of that text. If you use voice input, your browser may send your speech to its own speech service; we never receive or store that audio. Your learning progress and settings are saved as normal.',
    ],
  },
  {
    title: 'What your partner can see',
    body: [
      'Your display name always. Your country and English level only if you leave those switches on in Settings → Privacy. Never your email address, date of birth or account details.',
    ],
  },
  {
    title: 'Friends and private messages',
    body: [
      'Only people you have added as friends, and who accepted, can call or message you privately. Blocking someone ends the friendship and every open request at once. Private messages are stored on our servers so you can read them later; they are not end-to-end encrypted. You can delete a conversation for yourself, and removing a friend deletes the conversation for both of you.',
    ],
  },
  {
    title: 'Staying in control',
    body: [
      'You can end or skip any call instantly. After a call, and from your call history, you can block a partner so you are never matched again, and report behaviour that breaks the community guidelines.',
    ],
  },
  {
    title: 'Community guidelines',
    body: [
      'Be respectful. No harassment, hate speech, sexual content, scams or spam. Do not share personal contact details with people you have just met. Anyone breaking these rules may be suspended.',
    ],
  },
  {
    title: 'Your data',
    body: [
      'We store the account and profile information you give us, your call history (time, duration, partner display name), your feedback, your friends and private messages, and your learning results (scores, saved words and review schedules, never your answers). You can change your profile at any time and delete your account from Settings → Account. Deletion removes your profile, preferences and sign-in; anonymised call records may remain in your former partners’ history.',
    ],
  },
]

export function SafetyPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
      <h1 className="text-3xl font-semibold sm:text-4xl">Safety and privacy</h1>
      <p className="mt-4 text-lg text-muted">How {brand.name} protects the people who use it.</p>
      <div className="mt-12 space-y-10">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="text-xl font-semibold">{s.title}</h2>
            {s.body.map((p) => (
              <p key={p} className="mt-3 text-muted">{p}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
