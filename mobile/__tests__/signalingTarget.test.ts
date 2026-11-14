jest.mock('../src/lib/api', () => ({ api: jest.fn(), getBaseUrl: () => 'https://speakora-6mkd.onrender.com' }))
import { socketTarget } from '../src/features/call/signaling'

describe('socketTarget', () => {
  it('uses the socket address the ticket-issuing server reports, with that server as the Origin', () => {
    expect(socketTarget('https://speakora-1.onrender.com', 'tk', 'wss://speakora-6mkd.onrender.com/ws/signaling')).toEqual({
      url: 'wss://speakora-6mkd.onrender.com/ws/signaling?ticket=tk', origin: 'https://speakora-6mkd.onrender.com',
    })
  })

  it('derives the socket from the API address when the server does not say, and announces that https address as its Origin', () => {
    expect(socketTarget('https://speakora-6mkd.onrender.com/', 'a b', undefined)).toEqual({
      url: 'wss://speakora-6mkd.onrender.com/ws/signaling?ticket=a%20b', origin: 'https://speakora-6mkd.onrender.com',
    })
    expect(socketTarget('http://10.0.2.2:8080', 'tk', null)).toEqual({ url: 'ws://10.0.2.2:8080/ws/signaling?ticket=tk', origin: 'http://10.0.2.2:8080' })
  })

  it('ignores a server address that is not a WebSocket address', () => {
    expect(socketTarget('https://speakora-6mkd.onrender.com', 'tk', 'https://elsewhere.example/').url).toBe('wss://speakora-6mkd.onrender.com/ws/signaling?ticket=tk')
    expect(socketTarget('https://speakora-6mkd.onrender.com', 'tk', '').url).toBe('wss://speakora-6mkd.onrender.com/ws/signaling?ticket=tk')
  })
})
