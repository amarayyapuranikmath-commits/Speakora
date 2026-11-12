import { useNavigation } from '@react-navigation/native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, MessageSquare, MoreVertical, Phone } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { api } from '../../lib/api'
import { keys, useFriends, usePartners } from '../../lib/queries'
import type { Friend, FriendRequest } from '../../lib/types'
import { Avatar } from '../../ui/Avatar'
import { Alert, Button, ErrorState, Screen, Sheet, Spinner } from '../../ui/components'
import { colors, space, themed, type } from '../../ui/theme'
import { useCall } from '../call/CallContext'
import { PartnerSafety } from '../main/CallForms'

const details = (p: { englishLevel: string | null; country: string | null }) =>
  [p.englishLevel ? `English ${p.englishLevel}` : null, p.country].filter(Boolean).join(' · ')

const hairline = themed(() => ({ borderBottomWidth: 1, borderBottomColor: colors.line }))

/**
 * Friends: a plain list. Tap a person to open the conversation; Message and Call are one tap away, everything else (block, report,
 * remove) is in the three-dot menu. Previous partners are one quiet row at the bottom, not a second list.
 */
export function FriendsScreen() {
  const call = useCall()
  const nav = useNavigation<any>()
  const friends = useFriends()
  const partners = usePartners()
  const queryClient = useQueryClient()
  const busy = call.phase !== 'idle' && call.phase !== 'ended'
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.friends })
    void queryClient.invalidateQueries({ queryKey: keys.partners })
  }
  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'decline' | 'cancel' }) =>
      action === 'cancel' ? api(`/api/friends/requests/${id}`, { method: 'DELETE' }) : api(`/api/friends/requests/${id}/${action}`, { method: 'POST' }),
    onSettled: refresh,
  })
  const data = friends.data
  const partnerCount = partners.data?.length ?? 0

  return (
    <Screen>
      <Text accessibilityRole="header" style={[type.title, { marginBottom: space.xs }]}>Friends</Text>
      <Text style={[type.small, { marginBottom: space.lg }]}>Only friends can call or message you privately.</Text>

      <View style={{ gap: space.sm }}>
        {call.micError ? <Alert>Microphone unavailable. Allow the microphone for this app in Settings, then try again.</Alert> : null}
        {call.notice ? <Alert tone="info">{call.notice}</Alert> : null}
        {respond.isError ? <Alert>That did not go through. Please try again.</Alert> : null}
        {busy ? (
          <Pressable accessibilityRole="button" onPress={() => nav.navigate('Tabs', { screen: 'Talk' })}>
            <Alert tone="info">You are in a call or searching right now. Tap to go to the call.</Alert>
          </Pressable>
        ) : null}
      </View>

      {friends.isLoading ? <Spinner label="Loading friends" /> : friends.isError || !data ? <ErrorState onRetry={() => friends.refetch()} /> : (
        <>
          {data.incoming.length > 0 ? (
            <Section title={`Requests · ${data.incoming.length}`}>
              {data.incoming.map((r) => (
                <RequestRow key={r.id} request={r}>
                  <Button label={`Accept ${r.displayName}`} onPress={() => respond.mutate({ id: r.id, action: 'accept' })} disabled={respond.isPending} style={{ flex: 1, minHeight: 44 }} />
                  <Button label={`Decline ${r.displayName}`} variant="secondary" onPress={() => respond.mutate({ id: r.id, action: 'decline' })} disabled={respond.isPending} style={{ flex: 1, minHeight: 44 }} />
                </RequestRow>
              ))}
            </Section>
          ) : null}

          {data.friends.length > 0 ? (
            <Section title={`Friends · ${data.friends.length}`}>
              {data.friends.map((f) => <FriendRow key={f.ref} friend={f} callDisabled={busy || call.outgoing !== null} onChanged={refresh} />)}
            </Section>
          ) : data.incoming.length === 0 ? (
            <View style={{ paddingVertical: space.xxl }}>
              <Text style={[type.heading, { marginBottom: space.sm }]}>No friends yet</Text>
              <Text style={type.small}>After a conversation with someone, find them under Previous partners and choose Add friend. Once they accept, you can message and call each other.</Text>
              <Button label="Find a partner to talk to" onPress={() => nav.navigate('Tabs', { screen: 'Talk' })} style={{ marginTop: space.lg, alignSelf: 'flex-start' }} />
            </View>
          ) : null}

          {data.outgoing.length > 0 ? (
            <Section title="Sent requests">
              {data.outgoing.map((r) => (
                <RequestRow key={r.id} request={r}>
                  <Button label={`Cancel request to ${r.displayName}`} variant="secondary" onPress={() => respond.mutate({ id: r.id, action: 'cancel' })} disabled={respond.isPending} style={{ minHeight: 44 }} />
                </RequestRow>
              ))}
            </Section>
          ) : null}

          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Previous partners"
            onPress={() => nav.navigate('Partners')}
            style={[{ minHeight: 56, flexDirection: 'row', alignItems: 'center', marginTop: space.xl }, hairline, { borderTopWidth: 1, borderTopColor: colors.line }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>Previous partners</Text>
              <Text style={type.small}>{partnerCount > 0 ? `${partnerCount} ${partnerCount === 1 ? 'person' : 'people'} you have spoken with` : 'People you speak with appear here'}</Text>
            </View>
            <ChevronRight size={20} color={colors.muted} />
          </Pressable>
        </>
      )}
    </Screen>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.xl }}>
      <Text accessibilityRole="header" style={[type.label, { color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 12, marginBottom: space.xs }]}>{title}</Text>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.line }}>{children}</View>
    </View>
  )
}

function RequestRow({ request: r, children }: { request: FriendRequest; children: React.ReactNode }) {
  return (
    <View style={[{ paddingVertical: space.md }, hairline]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar name={r.displayName} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }} numberOfLines={1}>{r.displayName}</Text>
          {details(r) ? <Text style={type.small}>{details(r)}</Text> : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>{children}</View>
    </View>
  )
}

function FriendRow({ friend: f, callDisabled, onChanged }: { friend: Friend; callDisabled: boolean; onChanged: () => void }) {
  const call = useCall()
  const nav = useNavigation<any>()
  const [menu, setMenu] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const remove = useMutation({
    mutationFn: () => api(`/api/friends/${encodeURIComponent(f.ref)}`, { method: 'DELETE' }),
    onSettled: () => { setMenu(false); setConfirmRemove(false); onChanged() },
  })
  const open = () => nav.navigate('Chat', { ref: f.ref, name: f.displayName })
  const canCall = f.online && !callDisabled

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', minHeight: 68, paddingVertical: space.sm }, hairline]}>
      <Pressable accessibilityRole="button" accessibilityLabel={f.unread > 0 ? `Open conversation with ${f.displayName}, ${f.unread} unread` : `Open conversation with ${f.displayName}`} onPress={open} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 }}>
        <View>
          <Avatar name={f.displayName} size={46} />
          <View style={{ position: 'absolute', right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: colors.canvas, backgroundColor: f.online ? colors.success : colors.lineStrong }} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: f.unread > 0 ? '700' : '600', color: colors.ink }} numberOfLines={1}>{f.displayName}</Text>
          <Text style={type.small} numberOfLines={1}>{[details(f), f.online ? 'Online' : 'Offline'].filter(Boolean).join(' · ')}</Text>
        </View>
        {f.unread > 0 ? (
          <View accessibilityElementsHidden importantForAccessibility="no" style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
            <Text style={{ color: colors.onAccent, fontSize: 12, fontWeight: '700' }}>{f.unread > 99 ? '99+' : f.unread}</Text>
          </View>
        ) : null}
      </Pressable>
      <IconAction label={`Message ${f.displayName}`} onPress={open}><MessageSquare size={21} color={colors.ink} /></IconAction>
      <IconAction label={`Call ${f.displayName}`} disabled={!canCall} onPress={() => void call.requestConnect(f.ref, f.displayName)}><Phone size={21} color={colors.accent} /></IconAction>
      <IconAction label={`More options for ${f.displayName}`} onPress={() => setMenu(true)}><MoreVertical size={21} color={colors.muted} /></IconAction>

      <Sheet title={f.displayName} visible={menu} onClose={() => { setMenu(false); setConfirmRemove(false) }}>
        <View style={{ gap: space.md, paddingBottom: space.md }}>
          <PartnerSafety friendRef={f.ref} partnerName={f.displayName} onDone={() => { setMenu(false); onChanged() }} />
          {confirmRemove ? (
            <View>
              <Text style={type.small}>Remove {f.displayName} from your friends? You will both lose your private conversation. You can still be matched at random.</Text>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                <Button label="Remove friend" variant="secondary" onPress={() => remove.mutate()} loading={remove.isPending} style={{ flex: 1 }} />
                <Button label="Keep" variant="ghost" onPress={() => setConfirmRemove(false)} />
              </View>
            </View>
          ) : (
            <Button label={`Remove ${f.displayName} from friends`} variant="ghost" onPress={() => setConfirmRemove(true)} />
          )}
        </View>
      </Sheet>
    </View>
  )
}

function IconAction({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={2} style={{ width: 42, height: 48, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
      {children}
    </Pressable>
  )
}
