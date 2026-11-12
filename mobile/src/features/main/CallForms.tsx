import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, Flag, Star } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ApiError, api } from '../../lib/api'
import type { ReportReason } from '../../lib/types'
import { Alert, Button, Chip, PickerField, TextField, Toggle } from '../../ui/components'
import { colors, space, type } from '../../ui/theme'

export function FeedbackForm({ callId, onDone }: { callId: string; onDone?: () => void }) {
  const queryClient = useQueryClient()
  const [rating, setRating] = useState(0)
  const [respectful, setRespectful] = useState<boolean | null>(null)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const submit = useMutation({
    mutationFn: () => api(`/api/calls/${callId}/feedback`, { method: 'POST', body: { rating, partnerWasRespectful: respectful, comment: comment.trim() || null } }),
    onSuccess: () => {
      setSubmitted(true)
      void queryClient.invalidateQueries({ queryKey: ['calls'] })
      onDone?.()
    },
    onError: (e) => {
      // A duplicate means feedback is already saved, which is the state the user wants.
      if (e instanceof ApiError && e.code === 'FEEDBACK_EXISTS') setSubmitted(true)
    },
  })

  if (submitted) return <Alert tone="success">Thanks. Your feedback has been saved.</Alert>
  const errorMessage = submit.error instanceof ApiError && submit.error.code !== 'FEEDBACK_EXISTS' ? submit.error.message : submit.isError ? 'We could not save your feedback.' : null

  return (
    <View>
      {errorMessage ? <Alert>{errorMessage}</Alert> : null}
      <Text style={[type.label, { marginBottom: space.sm }]}>How was the conversation?</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Rating" style={{ flexDirection: 'row', marginBottom: space.lg }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: rating === n }} accessibilityLabel={`${n} out of 5`} onPress={() => setRating(n)} style={{ padding: 6 }}>
            <Star size={32} color={n <= rating ? '#D49A00' : colors.lineStrong} fill={n <= rating ? '#F5B800' : 'transparent'} />
          </Pressable>
        ))}
      </View>
      <Text style={[type.label, { marginBottom: space.sm }]}>Was your partner respectful?</Text>
      <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.lg }}>
        <Chip label="Yes" selected={respectful === true} onPress={() => setRespectful(respectful === true ? null : true)} />
        <Chip label="No" selected={respectful === false} onPress={() => setRespectful(respectful === false ? null : false)} />
      </View>
      <TextField label="Comments (optional)" value={comment} onChangeText={setComment} maxLength={1000} multiline numberOfLines={3} textAlignVertical="top" placeholder="Anything that would help us improve matching?" style={{ minHeight: 84 }} />
      <Button label="Submit feedback" onPress={() => rating > 0 && submit.mutate()} disabled={rating === 0} loading={submit.isPending} />
    </View>
  )
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'HARASSMENT', label: 'Harassment or bullying' },
  { value: 'HATE_OR_ABUSE', label: 'Hate speech or abuse' },
  { value: 'SEXUAL_CONTENT', label: 'Sexual or inappropriate content' },
  { value: 'SPAM_OR_SCAM', label: 'Spam or scam' },
  { value: 'UNDERAGE', label: 'Appears to be under 18' },
  { value: 'OTHER', label: 'Something else' },
]

/**
 * Block and report someone. A previous partner is identified through a call you shared; a friend through their friend handle
 * (pass `friendRef`). Never by account id.
 */
export function PartnerSafety({ callId, friendRef, partnerName, onDone }: { callId?: string; friendRef?: string; partnerName: string; onDone?: () => void }) {
  const base = friendRef ? `/api/friends/${encodeURIComponent(friendRef)}` : `/api/calls/${callId}`
  const blockPath = friendRef ? `${base}/block` : `${base}/block-partner`
  const [mode, setMode] = useState<'none' | 'report'>('none')
  const [reason, setReason] = useState<ReportReason>('HARASSMENT')
  const [details, setDetails] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(true)
  const [done, setDone] = useState<string | null>(null)

  const block = useMutation({
    mutationFn: () => api(blockPath, { method: 'POST' }),
    onSuccess: () => {
      setDone(`${partnerName} is blocked. You will not be matched or connected again.`)
      onDone?.()
    },
  })
  const report = useMutation({
    mutationFn: () => api(`${base}/report`, { method: 'POST', body: { reason, details: details.trim() || null, alsoBlock } }),
    onSuccess: () => {
      setDone(alsoBlock ? 'Report sent and partner blocked. Thank you for keeping the community safe.' : 'Report sent. Thank you for keeping the community safe.')
      setMode('none')
      if (alsoBlock) onDone?.()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REPORT_EXISTS') {
        setDone(friendRef ? 'You have already reported this person.' : 'You have already reported this call.')
        setMode('none')
      }
    },
  })

  if (done) return <Alert tone="success">{done}</Alert>
  const duplicate = report.error instanceof ApiError && report.error.code === 'REPORT_EXISTS'

  return (
    <View>
      {(block.isError || report.isError) && !duplicate ? <Alert>That did not go through. Please try again.</Alert> : null}
      {mode === 'none' ? (
        <View style={{ gap: space.sm }}>
          <Button label={`Block ${partnerName}`} variant="secondary" onPress={() => block.mutate()} loading={block.isPending} icon={<Ban size={18} color={colors.ink} />} />
          <Button label="Report" variant="secondary" onPress={() => setMode('report')} icon={<Flag size={18} color={colors.ink} />} />
        </View>
      ) : (
        <View>
          <PickerField label="What happened?" value={reason} options={REASONS} onChange={(v) => setReason(v as ReportReason)} />
          <TextField label="Details (optional)" value={details} onChangeText={setDetails} maxLength={1000} multiline numberOfLines={3} textAlignVertical="top" style={{ minHeight: 84 }} />
          <Toggle label={`Also block ${partnerName}`} value={alsoBlock} onChange={setAlsoBlock} />
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
            <Button label="Send report" onPress={() => report.mutate()} loading={report.isPending} style={{ flex: 1 }} />
            <Button label="Cancel" variant="ghost" onPress={() => setMode('none')} />
          </View>
        </View>
      )}
    </View>
  )
}
