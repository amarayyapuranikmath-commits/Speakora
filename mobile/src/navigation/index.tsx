import { BottomTabBar, createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { NavigationContainer, DarkTheme, DefaultTheme, type NavigationState, type PartialState } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { BookOpen, Home, LineChart, Mic, Sparkles, Users } from 'lucide-react-native'
import { useEffect } from 'react'
import { AppState, Pressable, Text, View } from 'react-native'
import { useCall } from '../features/call/CallContext'
import { TalkScreen } from '../features/call/TalkScreen'
import { useAuth } from '../features/auth/AuthContext'
import { ForgotScreen, LoginScreen, RegisterScreen, ResetScreen, WelcomeScreen, type AuthStackParams } from '../features/auth/screens'
import { CoachScreen } from '../features/main/CoachScreen'
import { HomeScreen } from '../features/main/HomeScreen'
import { HistoryScreen, ProgressScreen, TopicsScreen } from '../features/main/ListScreens'
import { OnboardingScreen } from '../features/main/OnboardingScreen'
import { ChatScreen } from '../features/friends/ChatScreen'
import { FriendsScreen } from '../features/friends/FriendsScreen'
import { DailyPracticeScreen, DailyScreen, LearnHomeScreen, LessonScreen, LevelScreen, LevelTestScreen, RevisionScreen, SubjectScreen, ThemeScreen, WordListScreen } from '../features/learn/LearnScreens'
import { useFriends } from '../lib/queries'
import { useLiveUpdates } from '../lib/useLiveUpdates'
import { NotAvailableScreen } from '../features/preview/NotAvailableScreen'
import { PartnersScreen } from '../features/partners/PartnersScreen'
import { RequestLayer } from '../features/partners/RequestLayer'
import { SettingsScreen } from '../features/main/SettingsScreen'
import { HeaderPresentContext, Spinner } from '../ui/components'
import { colors, isDark, justSwitchedTheme, space } from '../ui/theme'
import { visibleTabs, type Tab } from '../config/navigation'

/** The navigation container's own colours (screen backgrounds, headers, tab bar), read each time the app is drawn so they follow the theme. */
const navigationTheme = () => {
  const base = isDark() ? DarkTheme : DefaultTheme
  return { ...base, colors: { ...base.colors, background: colors.canvas, card: colors.surface, primary: colors.accent, text: colors.ink, border: colors.line } }
}

/** Where the person was, kept so that changing the theme (which rebuilds the screens) puts them back on the same screen. */
let lastNavigationState: NavigationState | PartialState<NavigationState> | undefined

/** Screens pushed above the tabs have a navigation header that already clears the status bar, so they must not add that inset again. */
function belowHeader<P extends object>(Component: React.ComponentType<P>): React.ComponentType<P> {
  const Wrapped = (props: P) => <HeaderPresentContext.Provider value><Component {...props} /></HeaderPresentContext.Provider>
  Wrapped.displayName = `BelowHeader(${Component.displayName ?? Component.name})`
  return Wrapped
}
const PartnersWithHeader = belowHeader(PartnersScreen)
const SubjectWithHeader = belowHeader(SubjectScreen)
const LevelWithHeader = belowHeader(LevelScreen)
const LessonWithHeader = belowHeader(LessonScreen)
const LevelTestWithHeader = belowHeader(LevelTestScreen)
const RevisionWithHeader = belowHeader(RevisionScreen)
const WordListWithHeader = belowHeader(WordListScreen)
const DailyWithHeader = belowHeader(DailyScreen)
const DailyPracticeWithHeader = belowHeader(DailyPracticeScreen)
const ThemeWithHeader = belowHeader(ThemeScreen)
const TopicsWithHeader = belowHeader(TopicsScreen)
const HistoryWithHeader = belowHeader(HistoryScreen)
const SettingsWithHeader = belowHeader(SettingsScreen)

const AuthStack = createNativeStackNavigator<AuthStackParams>()
const RootStack = createNativeStackNavigator()
const Tabs = createBottomTabNavigator()

/**
 * Keeps the signalling link open while the app is in the foreground and signed in, so previous partners can reach you and
 * you can see who is online; and takes you to the call when one begins on another tab (a match, or someone accepting).
 */
function LinkKeeper({ navigation, state }: Pick<BottomTabBarProps, 'navigation' | 'state'>) {
  const { ensureLink, phase } = useCall()
  const onTalk = state.routes[state.index]?.name === 'Talk'

  useEffect(() => {
    void ensureLink()
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void ensureLink()
    })
    return () => sub.remove()
  }, [ensureLink])

  useEffect(() => {
    if ((phase === 'starting' || phase === 'connecting') && !onTalk) {
      // Go through the root navigator: a screen pushed above the tabs (Previous partners, Settings) would otherwise stay on top of the call.
      const root = navigation.getParent()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (root) (root as any).navigate('Tabs', { screen: 'Talk' })
      else navigation.navigate('Talk')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  return null
}

/** Shown above the tab bar whenever a search or call is live and the user is looking at another tab. */
function CallBanner({ navigation, state }: Pick<BottomTabBarProps, 'navigation' | 'state'>) {
  const call = useCall()
  const live = call.phase === 'searching' || call.phase === 'connecting' || call.phase === 'connected' || call.phase === 'reconnecting'
  const onTalk = state.routes[state.index]?.name === 'Talk'
  if (!live || onTalk) return null
  const text = call.phase === 'searching' ? 'Looking for a partner…' : `In a call with ${call.partner?.displayName ?? 'your partner'}`
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text} Tap to return.`}
      onPress={() => navigation.navigate('Talk')}
      style={{ backgroundColor: colors.accent, paddingVertical: space.md, paddingHorizontal: space.lg, flexDirection: 'row', justifyContent: 'space-between' }}
    >
      <Text style={{ color: colors.onAccent, fontWeight: '600' }}>{text}</Text>
      <Text style={{ color: colors.onAccent }}>Return</Text>
    </Pressable>
  )
}

const TAB_ICONS: Record<Tab['id'], typeof Home> = { Home, Talk: Mic, Learn: BookOpen, Coach: Sparkles, Friends: Users, Progress: LineChart }

/** Screens for the sections that are built. Unbuilt sections (preview only) get a plain "not available yet" screen. */
function tabScreen(tab: Tab): React.ComponentType<any> {
  switch (tab.id) {
    case 'Home': return HomeScreen
    case 'Talk': return TalkScreen
    case 'Coach': return CoachScreen
    case 'Friends': return FriendsScreen
    case 'Learn': return LearnHomeScreen
    case 'Progress': return ProgressScreen
    default: return function Unbuilt() { return <NotAvailableScreen name={tab.label} /> }
  }
}

const TAB_SCREENS = Object.fromEntries(visibleTabs(true).map((t) => [t.id, tabScreen(t)])) as Record<Tab['id'], React.ComponentType<any>>

function MainTabs() {
  useLiveUpdates()
  const friends = useFriends()
  // Something to act on: unread messages plus requests waiting for an answer.
  const friendsBadge = (friends.data?.friends.reduce((n, f) => n + f.unread, 0) ?? 0) + (friends.data?.incoming.length ?? 0)
  return (
    <Tabs.Navigator
      screenOptions={{
        // No app header: every screen owns its top edge (safe area) and the profile lives on Home.
        headerShown: false,
        // The keyboard needs the whole bottom of the screen; the tab bar comes back when it closes.
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
      }}
      tabBar={(props) => (
        <View>
          <LinkKeeper navigation={props.navigation} state={props.state} />
          <CallBanner navigation={props.navigation} state={props.state} />
          <BottomTabBar {...props} />
        </View>
      )}
    >
      {visibleTabs().map((tab) => {
        const Icon = TAB_ICONS[tab.id]
        return (
          <Tabs.Screen
            key={tab.id}
            name={tab.id}
            component={TAB_SCREENS[tab.id]}
            options={{
              title: tab.label,
              tabBarLabel: tab.label,
              tabBarIcon: ({ color, size }) => <Icon color={color} size={size} />,
              tabBarBadge: tab.id === 'Friends' && friendsBadge > 0 ? friendsBadge : undefined,
              tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent },
              tabBarAccessibilityLabel: tab.id === 'Friends' && friendsBadge > 0 ? `Friends, ${friendsBadge} unread` : undefined,
            }}
          />
        )
      })}
    </Tabs.Navigator>
  )
}

export function Navigation() {
  const { status, user } = useAuth()

  let content
  if (status === 'loading') {
    content = <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.canvas }}><Spinner label="Starting" /></View>
  } else if (status === 'anonymous' || !user) {
    content = (
      <AuthStack.Navigator screenOptions={{ headerShown: false }}>
        <AuthStack.Screen name="Welcome" component={WelcomeScreen} />
        <AuthStack.Screen name="Login" component={LoginScreen} />
        <AuthStack.Screen name="Register" component={RegisterScreen} />
        <AuthStack.Screen name="Forgot" component={ForgotScreen} />
        <AuthStack.Screen name="Reset" component={ResetScreen} />
      </AuthStack.Navigator>
    )
  } else if (!user.onboardingCompleted) {
    content = (
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
      </RootStack.Navigator>
    )
  } else {
    content = (
      <RootStack.Navigator screenOptions={{ headerTintColor: colors.ink, headerShadowVisible: false, headerStyle: { backgroundColor: colors.canvas } }}>
        <RootStack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
        <RootStack.Screen name="Partners" component={PartnersWithHeader} options={{ title: '' }} />
        <RootStack.Screen name="Subject" component={SubjectWithHeader} options={{ title: '' }} />
        <RootStack.Screen name="LearnLevel" component={LevelWithHeader} options={{ title: '' }} />
        <RootStack.Screen name="Lesson" component={LessonWithHeader} options={{ title: '' }} />
        <RootStack.Screen name="LevelTest" component={LevelTestWithHeader} options={{ title: '' }} />
        <RootStack.Screen name="Revision" component={RevisionWithHeader} options={{ title: '' }} />
        <RootStack.Screen name="WordList" component={WordListWithHeader} options={{ title: '' }} />
        <RootStack.Screen name="Daily" component={DailyWithHeader} options={{ title: '' }} />
        <RootStack.Screen name="DailyPractice" component={DailyPracticeWithHeader} options={{ title: '' }} />
        <RootStack.Screen name="Theme" component={ThemeWithHeader} options={{ title: '' }} />
        <RootStack.Screen name="Chat" component={ChatScreen} options={{ headerShown: false }} />
        <RootStack.Screen name="Topics" component={TopicsWithHeader} options={{ title: '' }} />
        <RootStack.Screen name="History" component={HistoryWithHeader} options={{ title: 'History' }} />
        <RootStack.Screen name="Settings" component={SettingsWithHeader} options={{ title: '' }} />
      </RootStack.Navigator>
    )
  }
  return (
    <NavigationContainer theme={navigationTheme()} initialState={justSwitchedTheme() ? lastNavigationState : undefined} onStateChange={(state) => { lastNavigationState = state }}>
      {content}
      {status !== 'loading' && user?.onboardingCompleted ? <RequestLayer /> : null}
    </NavigationContainer>
  )
}
