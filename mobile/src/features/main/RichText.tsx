import { Fragment, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import { colors, space } from '../../ui/theme'

/** Bold text inside one line. Built from Text nodes only, so a reply can never inject anything. */
function inline(text: string, color: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<Text key={i++} style={{ fontWeight: '700', color }}>{m[1]}</Text>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** A tutor reply: paragraphs, "- " lists, numbered lists and **bold**, in the app's reading size. */
export function RichText({ text, color = colors.ink }: { text: string; color?: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push(<Text key={blocks.length} style={{ fontSize: 16, lineHeight: 24, color }}>{inline(para.join(' '), color)}</Text>)
    para = []
  }
  for (const raw of lines) {
    const line = raw.trim()
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flush()
      blocks.push(
        <View key={blocks.length} style={{ flexDirection: 'row', gap: space.sm, paddingLeft: 2 }}>
          <Text style={{ fontSize: 16, lineHeight: 24, color }}>{numbered ? `${numbered[1]}.` : '•'}</Text>
          <Text style={{ flex: 1, fontSize: 16, lineHeight: 24, color }}>{inline((bullet ?? numbered)![bullet ? 1 : 2], color)}</Text>
        </View>,
      )
    } else if (line === '') {
      flush()
    } else {
      para.push(line)
    }
  }
  flush()
  return <Fragment><View style={{ gap: 8 }}>{blocks}</View></Fragment>
}
