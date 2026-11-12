import { useNavigation, useRoute } from '@react-navigation/native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, ChevronLeft, MoreVertical, Phone } from 'lucide-react-native'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ApiError, api } from '../../lib/api'
import { dayLabel, formatTime, sameDay } from '../../lib/format'
import { keys, useFriends, useMessages } from '../../lib/queries'
import type { ChatMessage, MessagePage } from '../../lib/types'
import { Avatar } from '../../ui/Avatar'
import { Alert, Button, Input, Sheet, Spinner } from '../../ui/components'
import { colors, space, type } from '../../ui/theme'
import { useCall } from '../call/CallContext'
import { PartnerSafety } from '../main/CallForms'

const MAX_MESSAGE_LENGTH = 2000
const GROUP_MINUTES = 5

/** A private conversation with one friend. Only reachable for accepted friends; the server checks that on every request. */
export function ChatScreen() {
  const { params } = useRoute<any>()
  const ref: string = params?.ref ?? ''
  const friends = useFriends()
  const friend = friends.data?.friends.find((f) => f.ref === ref)

  if (friends.isLoading) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: 'center' }}><Spinner label="Loading conversation" /></SafeAreaView>
  if (!friend) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas, padding: space.lg }}>
        <Text accessibilityRole="header" style={type.title}>Conversation not available</Text>
        <Text style={[type.small, { marginTop: space.sm }]}>You can only message people who are your friends.</Text>
      </SafeAreaView>
    )
  }
  return <Conversation friendRef={ref} name={friend.displayName} online={friend.online} />
}

type Row = { kind: 'day'; key: string; label: string } | { kind: 'message'; key: string; message: ChatMessage; first: boolean; last: boolean }

/** Messages in order, with a day label whenever the day changes and neighbours from the same person kept together. */
export function toRows(messages: ChatMessage[]): Row[] {
  const rows: Row[] = []
  messages.forEach((m, i) => {
    const prev = messages[i - 1]
    const next = messages[i + 1]
    if (!prev || !sameDay(prev.createdAt, m.createdAt)) rows.push({ kind: 'day', key: `day-${m.id}`, label: dayLabel(m.createdAt) })
    const joinsPrev = !!prev && sameDay(prev.createdAt, m.createdAt) && prev.mine === m.mine && minutesBetween(prev.createdAt, m.createdAt) < GROUP_MINUTES
    const joinsNext = !!next && sameDay(next.createdAt, m.createdAt) && next.mine === m.mine && minutesBetween(m.createdAt, next.createdAt) < GROUP_MINUTES
    rows.push({ kind: 'message', key: m.id, message: m, first: !joinsPrev, last: !joinsNext })
  })
  return rows
}

const minutesBetween = (a: string, b: string) => Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 60000

// The list's props are kept identical from one render to the next. Typing in the composer re-renders the screen on every key, and a prop
// that is a new function or object each time makes the list redraw every message that is mounted, on each keystroke.
const keyOf = (r: Row) => r.key
const LIST_CONTENT = { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, flexGrow: 1 } as const

/** One line of the conversation. Memoized: it only redraws when its own message (or the friend's name) changes. */
const MessageRow = memo(function MessageRow({ item, name }: { item: Row; name: string }) {
  if (item.kind === 'day') return <Text style={[type.caption, { textAlign: 'center', marginVertical: space.md }]}>{item.label}</Text>
  const m = item.message
  return (
    <View style={{ alignItems: m.mine ? 'flex-end' : 'flex-start', marginTop: item.first ? space.sm : 2 }}>
      <View
        accessible
        accessibilityLabel={`${m.mine ? 'You' : name}, ${formatTime(m.createdAt)}: ${m.body}`}
        style={{
          maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 9, backgroundColor: m.mine ? colors.accent : colors.bubble,
          borderRadius: 18, borderBottomRightRadius: m.mine && item.last ? 5 : 18, borderBottomLeftRadius: !m.mine && item.last ? 5 : 18,
        }}
      >
        <Text style={{ fontSize: 16, lineHeight: 22, color: m.mine ? colors.onAccent : colors.ink }}>{m.body}</Text>
      </View>
      {item.last ? <Text style={[type.caption, { marginTop: 3, marginHorizontal: 4 }]}>{formatTime(m.createdAt)}</Text> : null}
    </View>
  )
})

function Conversation({ friendRef, name, online }: { friendRef: string; name: string; online: boolean }) {
  const call = useCall()
  const nav = useNavigation<any>()
  const queryClient = useQueryClient()
  const latest = useMessages(friendRef)
  const [older, setOlder] = useState<ChatMessage[]>([])
  const [moreOlder, setMoreOlder] = useState<boolean | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [text, setText] = useState('')
  const [menu, setMenu] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const list = useRef<FlatList<Row>>(null)
  const busy = call.phase !== 'idle' && call.phase !== 'ended'

  const messages = useMemo(() => {
    const seen = new Set<string>()
    return [...older, ...(latest.data?.messages ?? [])].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
  }, [older, latest.data])
  const rows = useMemo(() => toRows(messages), [messages])
  const hasEarlier = moreOlder ?? latest.data?.hasMore ?? false
  const lastId = messages.length ? messages[messages.length - 1].id : null

  // Reading the conversation marks it read; new messages that arrive while it is open are marked too.
  useEffect(() => {
    if (!latest.data) return
    void api(`/api/friends/${encodeURIComponent(friendRef)}/messages/read`, { method: 'POST' })
      .then(() => queryClient.invalidateQueries({ queryKey: keys.friends }))
      .catch(() => undefined)
  }, [friendRef, lastId, latest.data, queryClient])

  useEffect(() => {
    if (lastId) setTimeout(() => list.current?.scrollToEnd?.({ animated: false }), 0)
  }, [lastId])

  const send = useMutation({
    mutationFn: (body: string) => api<ChatMessage>(`/api/friends/${encodeURIComponent(friendRef)}/messages`, { method: 'POST', body: { body } }),
    onSuccess: () => {
      setText('')
      void queryClient.invalidateQueries({ queryKey: keys.messages(friendRef) })
      void queryClient.invalidateQueries({ queryKey: keys.friends })
    },
  })
  const clear = useMutation({
    mutationFn: () => api(`/api/friends/${encodeURIComponent(friendRef)}/messages`, { method: 'DELETE' }),
    onSuccess: () => {
      setOlder([])
      setMoreOlder(null)
      setConfirmClear(false)
      setMenu(false)
      void queryClient.invalidateQueries({ queryKey: keys.messages(friendRef) })
      void queryClient.invalidateQueries({ queryKey: keys.friends })
    },
  })

  async function loadOlder() {
    const first = messages[0]
    if (!first) return
    setLoadingOlder(true)
    try {
      const page = await api<MessagePage>(`/api/friends/${encodeURIComponent(friendRef)}/messages?before=${encodeURIComponent(first.createdAt)}`)
      setOlder((cur) => [...page.messages, ...cur])
      setMoreOlder(page.hasMore)
    } finally {
      setLoadingOlder(false)
    }
  }

  const trimmed = text.trim()
  const sendError = send.error instanceof ApiError ? send.error : null
  const submit = () => {
    if (trimmed && !send.isPending) send.mutate(trimmed)
  }

  const renderRow = useCallback(({ item }: { item: Row }) => <MessageRow item={item} name={name} />, [name])
  const keepNewestInView = useCallback(() => list.current?.scrollToEnd?.({ animated: false }), [])
  const listHeader = useMemo(
    () => (
      <View style={{ marginBottom: space.md }}>
        {hasEarlier ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Show earlier messages" onPress={() => void loadOlder()} disabled={loadingOlder} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            {loadingOlder ? <ActivityIndicator color={colors.accent} /> : <Text style={{ color: colors.accent, fontWeight: '600' }}>Show earlier messages</Text>}
          </Pressable>
        ) : null}
        <Text style={[type.caption, { textAlign: 'center', paddingHorizontal: space.lg }]}>
          Messages are stored on our servers so you can read them later. They are not end-to-end encrypted.
        </Text>
      </View>
    ),
    // loadOlder reads the first message, so the header is rebuilt when the messages change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasEarlier, loadingOlder, messages],
  )
  const listEmpty = useMemo(() => <Text style={[type.small, { textAlign: 'center', paddingVertical: space.xxl }]}>No messages yet. Say hello to {name}.</Text>, [name])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {/* Header: back, who, call, menu */}
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingLeft: space.xs, paddingRight: space.xs, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to friends" onPress={() => nav.goBack()} style={{ width: 44, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={26} color={colors.ink} />
          </Pressable>
          <Avatar name={name} size={38} />
          <View style={{ flex: 1, marginLeft: space.md }}>
            <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '600', color: colors.ink }} numberOfLines={1}>{name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: online ? colors.success : colors.lineStrong }} />
              <Text style={type.caption}>{online ? 'Online' : 'Offline'}</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${name}`}
            accessibilityState={{ disabled: !online || busy || call.outgoing !== null }}
            disabled={!online || busy || call.outgoing !== null}
            onPress={() => void call.requestConnect(friendRef, name)}
            style={{ width: 46, height: 48, alignItems: 'center', justifyContent: 'center', opacity: !online || busy || call.outgoing !== null ? 0.4 : 1 }}
          >
            <Phone size={22} color={colors.accent} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Conversation options" onPress={() => setMenu(true)} style={{ width: 44, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <MoreVertical size={22} color={colors.muted} />
          </Pressable>
        </View>

        {call.micError || call.notice ? (
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
            <Alert tone={call.micError ? 'error' : 'info'}>{call.micError ? 'Microphone unavailable. Allow the microphone for this app in Settings, then try again.' : call.notice}</Alert>
          </View>
        ) : null}

        <View style={{ flex: 1 }}>
          {latest.isLoading ? (
            <Spinner label="Loading messages" />
          ) : latest.isError ? (
            <View style={{ padding: space.lg }}><Alert>We could not load this conversation. Please try again.</Alert></View>
          ) : (
            <FlatList
              ref={list}
              data={rows}
              keyExtractor={keyOf}
              keyboardShouldPersistTaps="handled"
              // The visible height changes when the keyboard opens or closes: keep the newest message in view.
              onLayout={keepNewestInView}
              contentContainerStyle={LIST_CONTENT}
              ListHeaderComponent={listHeader}
              ListEmptyComponent={listEmpty}
              renderItem={renderRow}
            />
          )}
        </View>

        {/* Composer: always above the keyboard, dark text on white */}
        <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.sm, backgroundColor: colors.canvas }}>
          {sendError ? <View style={{ marginBottom: space.sm }}><Alert>{sendError.status === 404 ? 'You can only message friends.' : sendError.status === 429 ? sendError.message : 'The message was not sent. Your text is still here: try again.'}</Alert></View> : null}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
            <Input
              accessibilityLabel={`Message to ${name}`}
              value={text}
              onChangeText={setText}
              maxLength={MAX_MESSAGE_LENGTH}
              multiline
              placeholder="Message"
              style={{ flex: 1, minHeight: 46, maxHeight: 120, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 23, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16, lineHeight: 22 }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !trimmed, busy: send.isPending }}
              disabled={!trimmed || send.isPending}
              onPress={submit}
              style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, opacity: trimmed ? 1 : 0.4, alignItems: 'center', justifyContent: 'center' }}
            >
              {send.isPending ? <ActivityIndicator color={colors.onAccent} /> : <ArrowUp size={22} color={colors.onAccent} />}
            </Pressable>
          </View>
          {text.length > MAX_MESSAGE_LENGTH - 200 ? <Text style={[type.caption, { marginTop: 4 }]}>{MAX_MESSAGE_LENGTH - text.length} characters left.</Text> : null}
        </View>
      </KeyboardAvoidingView>

      <Sheet title={name} visible={menu} onClose={() => { setMenu(false); setConfirmClear(false) }}>
        <View style={{ gap: space.md, paddingBottom: space.md }}>
          <PartnerSafety friendRef={friendRef} partnerName={name} onDone={() => void queryClient.invalidateQueries({ queryKey: keys.friends })} />
          {confirmClear ? (
            <View>
              <Text style={type.small}>Delete this conversation for you? {name} keeps their own copy.</Text>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                <Button label="Delete for me" variant="secondary" onPress={() => clear.mutate()} loading={clear.isPending} style={{ flex: 1 }} />
                <Button label="Keep" variant="ghost" onPress={() => setConfirmClear(false)} />
              </View>
            </View>
          ) : (
            <Button label="Delete conversation for me" variant="ghost" onPress={() => setConfirmClear(true)} />
          )}
        </View>
      </Sheet>
    </SafeAreaView>
  )
}
