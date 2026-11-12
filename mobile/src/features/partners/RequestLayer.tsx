import { X } from 'lucide-react-native'
import { useEffect } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useCountdown } from '../../lib/useCountdown'
import { Avatar } from '../../ui/Avatar'
import { Button, Sheet } from '../../ui/components'
import { colors, space, type } from '../../ui/theme'
import { useCall } from '../call/CallContext'
import { resultMessage } from './partnerText'

/**
 * Everything about private-call requests that must be visible on any screen: the prompt when a friend asks to talk to you, the
 * "asking…" bar while you wait for an answer, and what happened to the request you sent.
 */
export function RequestLayer() {
  const call = useCall()
  return (
    <>
      {call.incoming ? <IncomingSheet /> : null}
      {call.outgoing ? <OutgoingBar /> : call.requestResult ? <ResultBar /> : null}
    </>
  )
}

function IncomingSheet() {
  const call = useCall()
  const req = call.incoming!
  const left = useCountdown(req.expiresAt)
  const { from } = req
  const details = [from.englishLevel ? `English ${from.englishLevel}` : null, from.country ?? null].filter(Boolean).join(' · ')

  useEffect(() => {
    if (left === 0) call.declineRequest()
  }, [left, call])

  return (
    <Sheet title="A friend wants to talk" visible onClose={call.declineRequest}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
        <Avatar name={from.displayName} size={56} />
        <View style={{ flex: 1 }}>
          <Text style={type.heading} numberOfLines={1}>{from.displayName}</Text>
          {details ? <Text style={type.small}>{details}</Text> : null}
        </View>
      </View>
      <Text accessibilityLiveRegion="polite" style={[type.small, { marginTop: space.lg }]}>
        {from.displayName} would like to talk with you now. Nothing starts unless you accept.
        {left !== null ? ` Answer within ${left}s.` : ''}
      </Text>
      <View style={{ gap: space.sm, marginTop: space.xl }}>
        <Button label="Accept and talk" onPress={() => void call.acceptRequest()} />
        <Button label="Not now" variant="secondary" onPress={call.declineRequest} />
      </View>
    </Sheet>
  )
}

function Bar({ children, tint }: { children: React.ReactNode; tint: string }) {
  const insets = useSafeAreaInsets()
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, elevation: 8, paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.lg, backgroundColor: tint, borderBottomWidth: 1, borderBottomColor: colors.line }}
    >
      {children}
    </View>
  )
}

function OutgoingBar() {
  const call = useCall()
  const out = call.outgoing!
  const left = useCountdown(out.expiresAt)
  return (
    <Bar tint={colors.accentSoft}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <Text style={[type.label, { flex: 1 }]} numberOfLines={1}>
          Asking {out.partnerName} to talk…{left !== null ? `  ${left}s` : ''}
        </Text>
        <Button label="Cancel" variant="secondary" onPress={call.cancelRequest} disabled={!out.requestId} />
      </View>
    </Bar>
  )
}

function ResultBar() {
  const call = useCall()
  const message = resultMessage(call.requestResult!)
  useEffect(() => {
    if (!message) call.dismissRequestResult()
  }, [message, call])
  if (!message) return null
  return (
    <Bar tint={colors.surface}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <Text style={[type.small, { flex: 1, color: colors.ink }]}>{message}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={call.dismissRequestResult} hitSlop={12}>
          <X size={20} color={colors.muted} />
        </Pressable>
      </View>
    </Bar>
  )
}
