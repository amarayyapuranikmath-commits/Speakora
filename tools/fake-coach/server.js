// Stand-in for Groq's OpenAI-compatible chat completions API (POST /chat/completions), used ONLY to test the tutor integration end to
// end without a real key. It returns canned replies in the same wire format (including server-sent events with choices[].delta.content
// and a [DONE] line), counts requests so tests can prove nothing is sent without consent, and reports what it was sent.
// Knobs: FAKE_COACH_PORT, FAKE_COACH_DELAY_MS (per streamed word).
const http = require('http')
const port = Number(process.env.FAKE_COACH_PORT || 4010)
const seen = { requests: 0, lastAuthorization: null, lastSystemMentionsLearnerText: null }

const completion = (text) => JSON.stringify({ id: 'chatcmpl-fake', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }] })

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/stats') {
    res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(seen))
  }
  if (req.method === 'POST' && req.url === '/chat/completions') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.requests++
      seen.lastAuthorization = req.headers['authorization'] ? 'Bearer <present>' : null // never echo the key
      const parsed = JSON.parse(body)
      const system = String(parsed.messages?.[0]?.role === 'system' ? parsed.messages[0].content : '')
      const turns = parsed.messages.filter((m) => m.role !== 'system')
      const userText = turns[0]?.content ?? ''
      if (!userText.includes('<learner_text>')) {
        // Conversation turn from the tutor chat: reply in plain text and report what the provider was sent, so tests can check it.
        const last = turns[turns.length - 1].content
        seen.lastChat = { turns: turns.length, roles: turns.map((m) => m.role), mode: (system.match(/Current mode: ([^.]*)\./) || [])[1] || null, stream: parsed.stream === true, systemHasSummary: system.includes('Summary of the earlier part'), model: parsed.model }
        const text = system.includes('memory note') ? 'The learner is practising grammar and wants simple examples.' : 'Fake tutor reply to: ' + last
        if (parsed.stream === true) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          const chunk = (delta, finish) => 'data: ' + JSON.stringify({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish || null }] }) + '\n\n'
          res.write(chunk({ role: 'assistant', content: '' }))
          const words = text.split(' ')
          let i = 0
          const tick = () => {
            if (i >= words.length) { res.write(chunk({}, 'stop')); res.write('data: [DONE]\n\n'); return res.end() }
            res.write(chunk({ content: words[i] + (i < words.length - 1 ? ' ' : '') }))
            i++
            setTimeout(tick, Number(process.env.FAKE_COACH_DELAY_MS || 25))
          }
          return tick()
        }
        res.setHeader('content-type', 'application/json')
        return res.end(completion(text))
      }
      seen.lastSystemMentionsLearnerText = userText.includes('<learner_text>') && system.includes(userText.slice(15, 30))
      const feedback = {
        summary: 'Good effort. Your ideas are clear and easy to follow.',
        strengths: ['Clear sequence of events'],
        corrections: /goed|buyed/.test(userText) ? [{ original: 'I goed', better: 'I went', explanation: '"Go" is an irregular verb: go, went, gone.' }] : [],
        vocabulary: [{ word: 'stroll', meaning: 'to walk slowly for pleasure', example: 'We took a stroll after dinner.' }],
        nextSteps: ['Tell the same story again without notes.'],
      }
      res.setHeader('content-type', 'application/json')
      res.end(completion('```json\n' + JSON.stringify(feedback) + '\n```'))
    })
    return
  }
  res.statusCode = 404; res.end()
}).listen(port, '127.0.0.1', () => console.log(`fake coach provider on 127.0.0.1:${port}`))
