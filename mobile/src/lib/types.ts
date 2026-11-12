export type EnglishLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'

export interface UserSummary {
  id: string
  email: string
  emailVerified: boolean
  displayName: string
  onboardingCompleted: boolean
  role: 'USER' | 'ADMIN'
}

export interface SessionResponse {
  accessToken: string
  expiresInSeconds: number
  user: UserSummary
}

export interface Profile {
  displayName: string
  country: string | null
  timeZone: string | null
  nativeLanguage: string | null
  englishLevel: EnglishLevel | null
  learningGoals: string[]
  interests: string[]
  onboardingCompleted: boolean
}

export interface ProfileInput {
  displayName: string
  country?: string
  timeZone?: string
  nativeLanguage?: string
  englishLevel?: EnglishLevel
  learningGoals: string[]
  interests: string[]
}

export interface Preferences {
  matchSimilarLevel: boolean
  showCountry: boolean
  showLevel: boolean
  notifyEmailReminders: boolean
  aiCoachConsent: boolean
  /** Whether friends may ask you for a private call. */
  allowPartnerRequests: boolean
}

export type FriendStatus = 'NONE' | 'REQUEST_SENT' | 'REQUEST_RECEIVED' | 'FRIENDS'

/** Someone you have talked to in a random call. Identified by an opaque `ref`, never by account id. */
export interface PartnerSummary {
  ref: string
  displayName: string
  englishLevel: EnglishLevel | null
  country: string | null
  conversations: number
  lastConversationAt: string
  /** A call you shared; used to block or report this person. */
  lastCallId: string
  friendStatus: FriendStatus
  canAddFriend: boolean
}

/** An accepted friend. `ref` is an opaque handle that only works for you. */
export interface Friend {
  ref: string
  displayName: string
  englishLevel: EnglishLevel | null
  country: string | null
  since: string
  online: boolean
  unread: number
  lastMessageAt: string | null
}

export interface FriendRequest {
  id: string
  displayName: string
  englishLevel: EnglishLevel | null
  country: string | null
  createdAt: string
}

export interface FriendsOverview {
  friends: Friend[]
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
}

export interface ChatMessage {
  id: string
  mine: boolean
  body: string
  createdAt: string
}

export interface MessagePage {
  messages: ChatMessage[]
  hasMore: boolean
}

export interface Topic {
  slug: string
  name: string
  description: string | null
  prompts: string[]
}

export type CallStatus =
  | 'MATCH_FOUND'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export type EndReason = 'ENDED' | 'SKIPPED' | 'DISCONNECTED' | 'FAILED' | 'TIMEOUT'

export interface CallSummary {
  id: string
  partnerDisplayName: string
  topicName: string | null
  status: CallStatus
  endReason: EndReason | null
  startedAt: string
  durationSeconds: number | null
  feedbackSubmitted: boolean
}

export interface PageResponse<T> {
  items: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export interface StatsSummary {
  totalSeconds: number
  completedCalls: number
  currentStreakDays: number
  longestStreakDays: number
  weekSeconds: number
  monthSeconds: number
  practisedToday: boolean
  englishLevel: EnglishLevel | null
}

export interface DayPoint {
  date: string
  seconds: number
  calls: number
}

export interface BlockedUser {
  userId: string
  displayName: string
  blockedAt: string
}

export type ReportReason =
  | 'HARASSMENT'
  | 'HATE_OR_ABUSE'
  | 'SEXUAL_CONTENT'
  | 'SPAM_OR_SCAM'
  | 'UNDERAGE'
  | 'OTHER'

export interface IceServer {
  urls: string[]
  username: string | null
  credential: string | null
}

export interface IceConfig {
  iceServers: IceServer[]
  turnConfigured: boolean
  ttlSeconds: number
  forceRelay: boolean
  /** ISO time after which the credentials are not accepted for new relays. */
  expiresAt: string
}

export interface CoachStatus {
  available: boolean
  consent: boolean
  dailyLimit: number
}

export type ReportStatus = 'OPEN' | 'ACTIONED' | 'DISMISSED'
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED'

export interface AdminReport {
  id: string
  createdAt: string
  status: ReportStatus
  reason: ReportReason
  details: string | null
  callId: string | null
  reporterName: string
  reportedUserId: string
  reportedName: string
  reportedStatus: AccountStatus | null
  openReportsAgainst: number
  totalReportsAgainst: number
  resolutionNote: string | null
  resolvedAt: string | null
}

export interface AdminUser {
  id: string
  email: string
  displayName: string
  status: AccountStatus
  role: 'USER' | 'ADMIN'
  createdAt: string
  suspendedReason: string | null
  openReportsAgainst: number
  totalReportsAgainst: number
}

export interface SystemReport {
  baseUrl: string
  https: boolean
  cookieSecure: boolean
  corsOrigins: string[]
  smtpConfigured: boolean
  mailFrom: string
  coachConfigured: boolean
  coachModel: string
  turnConfigured: boolean
  turnUrls: string[]
  forceRelay: boolean
  warnings: string[]
}

export interface SystemCheck {
  name: string
  ok: boolean
  detail: string
}
