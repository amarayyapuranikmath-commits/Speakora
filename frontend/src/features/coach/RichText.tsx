import type { ReactNode } from 'react'

/**
 * Shows a tutor reply with the little formatting it uses (paragraphs, "- " lists, numbered lists, **bold**). Everything is built as
 * React nodes, never as HTML, so a reply cannot inject markup.
 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(m[1] ? <strong key={i++} className="font-semibold">{m[1]}</strong> : <code key={i++} className="rounded bg-black/5 px-1 py-0.5 text-[0.92em]">{m[2]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(<Tag key={blocks.length} className={`${list.ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>{list.items.map((t, i) => <li key={i}>{inline(t)}</li>)}</Tag>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.trim()
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flushPara()
      const ordered = !!numbered
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
      list.items.push((bullet ?? numbered)![1])
    } else if (line === '') {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return <div className="space-y-2.5 break-words">{blocks}</div>
}
