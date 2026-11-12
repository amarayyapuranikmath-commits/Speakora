import { useNavigation } from '@react-navigation/native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, MoreHorizontal, UserPlus } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ApiError, api } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { keys, usePartners } from '../../lib/queries'
import type { PartnerSummary } from '../../lib/types'
import { Avatar } from '../../ui/Avatar'
import { Alert, Button, EmptyState, ErrorState, RowList, Screen, Spinner, Title } from '../../ui/components'
import { colors, space, type } from '../../ui/theme'
import { PartnerSafety } from '../main/CallForms'

export function PartnersScreen() {
  const partners = usePartners()

  return (
    <Screen>
      <Title sub="People you have had a conversation with. You can add someone as a friend. Friends can call and message you privately. You can still be matched with previous partners at random.">Previous partners</Title>
      {partners.isLoading ? <Spinner label="Loading previous partners" /> : partners.isError || !partners.data ? <ErrorState onRetry={() => partners.refetch()} /> :
        partners.data.length === 0 ? (
          <EmptyState title="No previous partners yet" description="After a conversation of at least a few seconds, the person you talked to appears here." />
        ) : (
          <RowList>
            {partners.data.map((p) => <PartnerRow key={p.ref} partner={p} />)}
          </RowList>
        )}
    </Screen>
  )
}

function PartnerRow({ partner: p }: { partner: PartnerSummary }) {
  const nav = useNavigation<any>()
  const queryClient = useQueryClient()
  const [more, setMore] = useState(false)
  const details = [p.englishLevel ? `English ${p.englishLevel}` : null, p.country].filter(Boolean).join(' · ')

  const add = useMutation({
    mutationFn: () => api('/api/friends/requests', { method: 'POST', body: { partnerRef: p.ref } }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.partners })
      void queryClient.invalidateQueries({ queryKey: keys.friends })
    },
  })
  const addError = add.error instanceof ApiError ? add.error : null

  return (
    <View style={{ paddingVertical: space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar name={p.displayName} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={type.heading} numberOfLines={1}>{p.displayName}</Text>
          {details ? <Text style={type.small}>{details}</Text> : null}
          <Text style={type.small}>
            Last talked {formatDate(p.lastConversationAt)} · {p.conversations} {p.conversations === 1 ? 'conversation' : 'conversations'}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          {p.friendStatus === 'FRIENDS' ? (
            <Button label={`${p.displayName} is your friend`} variant="secondary" onPress={() => nav.navigate('Tabs', { screen: 'Friends' })} icon={<Check size={18} color={colors.ink} />} />
          ) : p.friendStatus === 'REQUEST_SENT' ? (
            <Text accessibilityRole="text" style={[type.small, { paddingVertical: space.md }]}>Request sent</Text>
          ) : p.friendStatus === 'REQUEST_RECEIVED' ? (
            <Button label="Respond to request" variant="secondary" onPress={() => nav.navigate('Tabs', { screen: 'Friends' })} />
          ) : (
            <Button
              label={`Add ${p.displayName} as a friend`}
              onPress={() => add.mutate()}
              loading={add.isPending}
              disabled={!p.canAddFriend}
              icon={<UserPlus size={18} color={colors.onAccent} />}
            />
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More options for ${p.displayName}`}
          accessibilityState={{ expanded: more }}
          onPress={() => setMore((v) => !v)}
          style={{ justifyContent: 'center', paddingHorizontal: space.md, minHeight: 48 }}
        >
          <MoreHorizontal size={22} color={colors.muted} />
        </Pressable>
      </View>
      {addError ? <View style={{ marginTop: space.md }}><Alert>{addError.status === 429 ? addError.message : 'That did not go through. Please try again.'}</Alert></View> : null}
      {more ? (
        <View style={{ marginTop: space.md, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space.md }}>
          <PartnerSafety callId={p.lastCallId} partnerName={p.displayName} onDone={() => void queryClient.invalidateQueries({ queryKey: keys.partners })} />
        </View>
      ) : null}
    </View>
  )
}
