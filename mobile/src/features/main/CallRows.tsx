import { useState } from 'react'
import { Text, View } from 'react-native'
import { formatDateTime, formatDuration } from '../../lib/format'
import type { CallStatus, CallSummary } from '../../lib/types'
import { Button, Panel, Sheet } from '../../ui/components'
import { colors, space, themed, type } from '../../ui/theme'
import { FeedbackForm, PartnerSafety } from './CallForms'

const STATUS = themed<Record<CallStatus, { label: string; bg: string; fg: string }>>(() => ({
  COMPLETED: { label: 'Completed', bg: colors.successSoft, fg: colors.success },
  FAILED: { label: 'Did not connect', bg: colors.dangerSoft, fg: colors.danger },
  CANCELLED: { label: 'Ended early', bg: colors.wash, fg: colors.muted },
  MATCH_FOUND: { label: 'Starting', bg: colors.wash, fg: colors.muted },
  CONNECTING: { label: 'Connecting', bg: colors.wash, fg: colors.muted },
  CONNECTED: { label: 'In progress', bg: colors.accentSoft, fg: colors.accent },
  RECONNECTING: { label: 'In progress', bg: colors.accentSoft, fg: colors.accent },
}))

export function StatusBadge({ status }: { status: CallStatus }) {
  const s = STATUS[status]
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: s.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ color: s.fg, fontSize: 12, fontWeight: '600' }}>{s.label}</Text>
    </View>
  )
}

/** List of calls with a per-row sheet for feedback, blocking and reporting. */
export function CallRows({ calls }: { calls: CallSummary[] }) {
  const [active, setActive] = useState<{ call: CallSummary; mode: 'feedback' | 'safety' } | null>(null)
  return (
    <>
      <Panel style={{ padding: 0, overflow: 'hidden' }}>
        {calls.map((c, i) => (
          <View key={c.id} style={{ padding: space.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Text style={type.label} numberOfLines={1}>{c.partnerDisplayName}</Text>
                <Text style={[type.small, { marginTop: 2 }]}>
                  {formatDateTime(c.startedAt)}{c.topicName ? ` · ${c.topicName}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <StatusBadge status={c.status} />
                {c.status === 'COMPLETED' ? <Text style={type.small}>{formatDuration(c.durationSeconds)}</Text> : null}
              </View>
            </View>
            {c.status === 'COMPLETED' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md }}>
                {c.feedbackSubmitted ? (
                  <Text style={[type.caption, { flex: 1 }]}>Feedback sent</Text>
                ) : (
                  <Button label="Leave feedback" variant="secondary" onPress={() => setActive({ call: c, mode: 'feedback' })} style={{ minHeight: 40, paddingHorizontal: space.md }} />
                )}
                <Button label="Block or report" variant="ghost" onPress={() => setActive({ call: c, mode: 'safety' })} style={{ minHeight: 40, paddingHorizontal: space.md }} />
              </View>
            ) : null}
          </View>
        ))}
      </Panel>

      <Sheet
        visible={!!active}
        onClose={() => setActive(null)}
        title={active ? (active.mode === 'feedback' ? `Feedback for ${active.call.partnerDisplayName}` : `Block or report ${active.call.partnerDisplayName}`) : ''}
      >
        {active?.mode === 'feedback' ? <FeedbackForm callId={active.call.id} onDone={() => setTimeout(() => setActive(null), 1200)} /> : null}
        {active?.mode === 'safety' ? <PartnerSafety callId={active.call.id} partnerName={active.call.partnerDisplayName} /> : null}
      </Sheet>
    </>
  )
}
