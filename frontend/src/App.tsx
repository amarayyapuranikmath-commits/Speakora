import { Suspense } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { RouteTitle } from './components/RouteTitle'
import { LinkButton } from './components/ui/Button'
import { Spinner } from './components/ui/feedback'
import { AdminRoute, GuestRoute, ProtectedRoute } from './features/auth/ProtectedRoute'
import { FindPartnerPage } from './features/call/FindPartnerPage'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { LandingPage } from './features/landing/LandingPage'
import { AppLayout } from './layouts/AppLayout'
import { PublicLayout } from './layouts/PublicLayout'
import { lazyScreen } from './routes'

// Screens load on demand so the first paint stays small: the form libraries (zod, react-hook-form) are only needed on the auth screens,
// and each other screen is only needed once it is opened. routes.ts starts fetching the right one early (see preloadRoute) and renders it without suspending once it is there.
const SafetyPage = lazyScreen('safety', 'SafetyPage')
const LoginPage = lazyScreen('login', 'LoginPage')
const RegisterPage = lazyScreen('register', 'RegisterPage')
const ForgotPasswordPage = lazyScreen('forgotPassword', 'ForgotPasswordPage')
const ResetPasswordPage = lazyScreen('resetPassword', 'ResetPasswordPage')
const VerifyEmailPage = lazyScreen('verifyEmail', 'VerifyEmailPage')
const OnboardingPage = lazyScreen('onboarding', 'OnboardingPage')
const TopicsPage = lazyScreen('topics', 'TopicsPage')
const CoachPage = lazyScreen('coach', 'CoachPage')
const HistoryPage = lazyScreen('history', 'HistoryPage')
const ProgressPage = lazyScreen('progress', 'ProgressPage')
const SettingsPage = lazyScreen('settings', 'SettingsPage')
const AdminPage = lazyScreen('admin', 'AdminPage')
const PartnersPage = lazyScreen('partners', 'PartnersPage')
const LearnHome = lazyScreen('learn', 'LearnHome')
const SubjectPage = lazyScreen('learn', 'SubjectPage')
const LevelPage = lazyScreen('learn', 'LevelPage')
const LessonPage = lazyScreen('learn', 'LessonPage')
const LevelTestPage = lazyScreen('learn', 'LevelTestPage')
const RevisionPage = lazyScreen('learn', 'RevisionPage')
const TodayWordsPage = lazyScreen('learn', 'TodayWordsPage')
const DailyPage = lazyScreen('learn', 'DailyPage')
const DailyPracticePage = lazyScreen('learn', 'DailyPracticePage')
const ThemePage = lazyScreen('learn', 'ThemePage')
const SavedWordsPage = lazyScreen('learn', 'SavedWordsPage')
const DifficultWordsPage = lazyScreen('learn', 'DifficultWordsPage')
const SavedPhrasalPage = lazyScreen('learn', 'SavedPhrasalPage')
const FriendsPage = lazyScreen('friends', 'FriendsPage')
const ChatPage = lazyScreen('chat', 'ChatPage')

export default function App() {
  return (
    <>
      <RouteTitle />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<LandingPage />} />
            <Route path="safety" element={<SafetyPage />} />
          </Route>

          <Route element={<GuestRoute />}>
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
          </Route>
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="verify-email" element={<VerifyEmailPage />} />

          <Route element={<ProtectedRoute onboarding />}>
            <Route path="onboarding" element={<OnboardingPage />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route path="app" element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="talk" element={<FindPartnerPage />} />
              <Route path="partners" element={<PartnersPage />} />
              <Route path="friends" element={<FriendsPage />} />
              <Route path="friends/:ref" element={<ChatPage />} />
              <Route path="topics" element={<TopicsPage />} />
              <Route path="coach" element={<CoachPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="progress" element={<ProgressPage />} />
              <Route path="settings" element={<SettingsPage />} />
              {/* Sections that are not built yet exist only in design-review preview mode (VITE_SHOW_UNBUILT_TABS=1). */}
              <Route path="learn" element={<LearnHome />} />
              <Route path="learn/revision" element={<RevisionPage />} />
              <Route path="learn/today" element={<DailyPage />} />
              <Route path="learn/today/practice/:part" element={<DailyPracticePage />} />
              <Route path="learn/vocabulary/today" element={<TodayWordsPage />} />
              <Route path="learn/vocabulary/saved" element={<SavedWordsPage />} />
              <Route path="learn/vocabulary/difficult" element={<DifficultWordsPage />} />
              <Route path="learn/phrasal/saved" element={<SavedPhrasalPage />} />
              <Route path="learn/lessons/:id" element={<LessonPage />} />
              <Route path="learn/tests/:subject/:level" element={<LevelTestPage />} />
              <Route path="learn/:subject" element={<SubjectPage />} />
              <Route path="learn/:subject/levels/:level" element={<LevelPage />} />
              <Route path="learn/:subject/topics/:theme" element={<ThemePage />} />
              <Route element={<AdminRoute />}>
                <Route path="admin" element={<AdminPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  )
}

function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted">The page you are looking for does not exist.</p>
      <div className="mt-6 flex gap-3">
        <LinkButton to="/">Go home</LinkButton>
        <Link to="/app" className="inline-flex h-10 items-center px-4 text-sm font-medium text-muted hover:text-ink">Open app</Link>
      </div>
    </div>
  )
}
