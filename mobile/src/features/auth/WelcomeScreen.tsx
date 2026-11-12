import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ArrowRight, Mic, ShieldCheck, UserCheck } from 'lucide-react-native'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { APP_NAME } from '../../config'
import { getBaseUrl, setBaseUrl } from '../../lib/api'
import { saveServerUrl } from '../../lib/storage'
import { BrandMark } from '../../ui/BrandMark'
import { Button, TextField } from '../../ui/components'
import { colors, space, themed, type } from '../../ui/theme'
import { GlobalHero, useReducedMotion } from './GlobalHero'
import type { AuthStackParams } from './screens'

type Props = NativeStackScreenProps<AuthStackParams, 'Welcome'>

/** Fades and lifts its children in after `delay` ms (static when the user has turned animations off). */
function Rise({ delay, reduced, children }: { delay: number; reduced: boolean; children: ReactNode }) {
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current
  useEffect(() => {
    if (reduced) {
      v.setValue(1)
      return
    }
    Animated.timing(v, { toValue: 1, duration: 520, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [delay, reduced, v])
  return <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>{children}</Animated.View>
}

const POINTS = [
  { Icon: Mic, label: 'Voice only' },
  { Icon: ShieldCheck, label: 'Never recorded' },
  { Icon: UserCheck, label: 'Adults 18+' },
]

export function WelcomeScreen({ navigation }: Props) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const [server, setServer] = useState(getBaseUrl())
  const [serverSaved, setServerSaved] = useState(false)
  const [showServer, setShowServer] = useState(false)

  // The globe scales with the screen: roughly half the height on tall phones, never wider than the screen.
  const stageHeight = Math.round(Math.max(310, Math.min(height * 0.52, 500)))
  const heroSize = Math.round(Math.max(220, Math.min(width - 24, stageHeight - insets.top - 70, 400)))
  const headlineSize = width < 360 ? 30 : 34

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <StatusBar barStyle="light-content" />
      <ScrollView bounces={false} overScrollMode="never" showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ height: stageHeight, paddingTop: insets.top }}>
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="stage" x1="0" y1="0" x2="0.35" y2="1">
                <Stop offset="0" stopColor="#08173A" />
                <Stop offset="0.6" stopColor="#12307A" />
                <Stop offset="1" stopColor="#1D4ED8" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#stage)" />
          </Svg>
          <View style={styles.brandRow} accessibilityRole="header">
            <BrandMark size={32} onDark />
            <Text style={styles.brandName}>{APP_NAME}</Text>
          </View>
          <View style={styles.heroBox}>
            <GlobalHero size={heroSize} />
          </View>
        </View>

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.xl }]}>
          <Rise delay={150} reduced={reduced}>
            <Text accessibilityRole="header" style={[styles.headline, { fontSize: headlineSize, lineHeight: headlineSize + 4 }]}>Speak English with the world.</Text>
            <Text style={styles.sub}>Practise spoken English in real one-to-one conversations with other learners.</Text>
          </Rise>

          <Rise delay={300} reduced={reduced}>
            <View style={styles.points}>
              {POINTS.map(({ Icon, label }) => (
                <View key={label} style={styles.point}>
                  <Icon size={15} color={colors.accent} />
                  <Text style={styles.pointText}>{label}</Text>
                </View>
              ))}
            </View>
          </Rise>

          <Rise delay={450} reduced={reduced}>
            <View style={{ gap: space.md, marginTop: space.xl }}>
              <Button label="Start Speaking" onPress={() => navigation.navigate('Register')} icon={<ArrowRight size={20} color={colors.onAccent} />} style={styles.cta} />
              <Button label="Sign In" variant="secondary" onPress={() => navigation.navigate('Login')} style={styles.cta} />
            </View>
          </Rise>

          {__DEV__ ? (
            <View style={{ marginTop: space.xl }}>
              <Pressable accessibilityRole="button" onPress={() => setShowServer((s) => !s)} hitSlop={8}>
                <Text style={type.caption}>{showServer ? 'Hide server settings' : 'Developer: server settings'}</Text>
              </Pressable>
              {showServer ? (
                <View style={{ marginTop: space.md }}>
                  <TextField label="Server address (debug builds only)" value={server} onChangeText={(t) => { setServer(t); setServerSaved(false) }} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
                  <Button label={serverSaved ? 'Saved' : 'Use this server'} variant="secondary" onPress={async () => { setBaseUrl(server); await saveServerUrl(server); setServerSaved(true) }} />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = themed(() => StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.xl, paddingTop: space.md },
  brandName: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  heroBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: space.xl },
  sheet: { flexGrow: 1, marginTop: -28, backgroundColor: colors.canvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: space.xl, paddingTop: space.xl + 4 },
  headline: { fontWeight: '700', letterSpacing: -1, color: colors.ink },
  sub: { fontSize: 16, lineHeight: 24, color: colors.muted, marginTop: space.md },
  points: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: space.lg },
  point: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pointText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  cta: { minHeight: 54, borderRadius: 14 },
}))
