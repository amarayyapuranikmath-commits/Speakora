import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const renders = vi.hoisted(() => ({ count: 0 }))
vi.mock('./RichText', () => ({ RichText: ({ text }: { text: string }) => { renders.count++; return <p>{text}</p> } }))

import { MessageRow, type Msg } from './MessageRow'

describe('MessageRow', () => {
  it('is not redrawn when an earlier message is untouched while a later reply streams', () => {
    renders.count = 0
    const first: Msg = { key: 'a', role: 'assistant', content: 'An earlier answer.' }
    const { rerender } = render(<MessageRow m={first} />)
    expect(renders.count).toBe(1)
    rerender(<MessageRow m={first} />) // the parent redrew for a new piece of another message: same object
    rerender(<MessageRow m={first} />)
    expect(renders.count).toBe(1)
    rerender(<MessageRow m={{ ...first, content: 'An earlier answer, edited.' }} />) // a changed message does redraw
    expect(renders.count).toBe(2)
  })

  it('shows the thinking indicator, the growing reply, the stopped note and user text exactly as before', () => {
    const { getByRole, getByText, rerender } = render(<MessageRow m={{ key: 'k', role: 'assistant', content: '', streaming: true }} />)
    expect(getByRole('status', { name: 'The coach is thinking' })).toBeInTheDocument()
    rerender(<MessageRow m={{ key: 'k', role: 'assistant', content: 'Hello', stopped: true }} />)
    expect(getByText('Hello')).toBeInTheDocument()
    expect(getByText('Stopped.')).toBeInTheDocument()
    rerender(<MessageRow m={{ key: 'u', role: 'user', content: 'I goed home' }} />)
    expect(getByText('I goed home')).toBeInTheDocument()
    rerender(<MessageRow m={{ key: 'n', role: 'assistant', content: '', note: 'Switched to Grammar.' }} />)
    expect(getByText('Switched to Grammar.')).toBeInTheDocument()
  })
})
