import { useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg'

/**
 * The welcome-screen hero: a dotted globe lit from the upper left, two people (pins) linked by an arc with a signal
 * travelling along it, a tilted orbit ring that passes behind and in front of the globe, and glass conversation
 * bubbles floating at different depths.
 *
 * Performance: the globe is a single static SVG (about 250 dots). Everything that moves is an Animated.View driven by the
 * native driver (transform and opacity only), so the JS thread stays idle while it plays. With "remove animations" turned
 * on in Android settings the scene is drawn still.
 */

const R = 104 // globe radius in the 300x300 design space
const C = 150
const PIN_A = { x: 112, y: 118 }
const PIN_B = { x: 196, y: 176 }
const ARC_CONTROL = { x: 204, y: 70 }

/** Abstract "land" pattern on a sphere: orthographic projection of a lat/long grid, brighter where a smooth function is high. */
function globeDots() {
  const dots: { x: number; y: number; r: number; o: number }[] = []
  for (let latDeg = -80; latDeg <= 80; latDeg += 10) {
    const phi = (latDeg * Math.PI) / 180
    const step = 10 / Math.max(Math.cos(phi), 0.3)
    for (let lonDeg = -90; lonDeg <= 90; lonDeg += step) {
      const lam = (lonDeg * Math.PI) / 180
      const depth = Math.cos(phi) * Math.cos(lam)
      if (depth <= 0.05) continue
      const land = Math.sin(lam * 2.3 + phi * 1.7 + 0.5) + Math.cos(phi * 3.1 - lam * 1.3) > 0.55
      dots.push({
        x: C + R * Math.cos(phi) * Math.sin(lam),
        y: C - R * Math.sin(phi),
        r: 0.7 + depth * 1.5,
        o: (land ? 0.95 : 0.28) * (0.35 + depth * 0.65),
      })
    }
  }
  return dots
}

const bezier = (t: number, a: number, c: number, b: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduced(v)).catch(() => undefined)
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      alive = false
      sub.remove()
    }
  }, [])
  return reduced
}

/** 0 → 1 → 0 forever (eased), after an optional delay. */
function usePingPong(duration: number, enabled: boolean, delay = 0) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!enabled) return
    const half = { duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }
    const loop = Animated.sequence([Animated.delay(delay), Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, ...half }), Animated.timing(v, { toValue: 0, ...half })]))])
    loop.start()
    return () => loop.stop()
  }, [duration, delay, enabled, v])
  return v
}

/** 0 → 1 repeatedly (linear), for spins, pulses and the travelling signal. */
function useCycle(duration: number, enabled: boolean, delay = 0) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!enabled) return
    const loop = Animated.sequence([Animated.delay(delay), Animated.loop(Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }))])
    loop.start()
    return () => loop.stop()
  }, [duration, delay, enabled, v])
  return v
}

function Bar({ lo, hi, duration, animate }: { lo: number; hi: number; duration: number; animate: boolean }) {
  const v = usePingPong(duration, animate)
  return <Animated.View style={[styles.bar, { transform: [{ scaleY: v.interpolate({ inputRange: [0, 1], outputRange: [lo, hi] }) }] }]} />
}

function Bubble({ style, float, delay, animate, children }: { style: StyleProp<ViewStyle>; float: number; delay: number; animate: boolean; children: React.ReactNode }) {
  const v = usePingPong(3200 + float * 120, animate, delay)
  return (
    <Animated.View
      style={[
        styles.bubble,
        style,
        { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -float] }) }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-1.2deg', '1.2deg'] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  )
}

function Avatar({ tint }: { tint: string }) {
  return <View style={[styles.avatar, { backgroundColor: tint }]} />
}

export function GlobalHero({ size }: { size: number }) {
  const reduced = useReducedMotion()
  const animate = !reduced
  const S = size
  const k = S / 300
  const dots = useMemo(globeDots, [])

  const enter = useRef(new Animated.Value(reduced ? 1 : 0)).current
  useEffect(() => {
    if (reduced) {
      enter.setValue(1)
      return
    }
    Animated.timing(enter, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [enter, reduced])

  const spin = useCycle(26000, animate)
  const pulseA = useCycle(2600, animate)
  const pulseB = useCycle(2600, animate, 1300)
  const signal = useCycle(2600, animate)

  // The signal packet follows the arc (a quadratic curve), sampled so the native driver can interpolate it.
  const samples = useMemo(() => Array.from({ length: 13 }, (_, i) => i / 12), [])
  const sx = signal.interpolate({ inputRange: samples, outputRange: samples.map((t) => bezier(t, PIN_A.x, ARC_CONTROL.x, PIN_B.x) * k - 4) })
  const sy = signal.interpolate({ inputRange: samples, outputRange: samples.map((t) => bezier(t, PIN_A.y, ARC_CONTROL.y, PIN_B.y) * k - 4) })
  const signalOpacity = signal.interpolate({ inputRange: [0, 0.08, 0.9, 1], outputRange: [0, 1, 1, 0] })

  const ringSize = S * 1.05
  const ring = (
    <Animated.View style={{ width: ringSize, height: ringSize, transform: [{ perspective: 900 }, { rotateX: '72deg' }, { rotate: '-14deg' }] }}>
      <View style={[StyleSheet.absoluteFill, styles.ring, { borderRadius: ringSize / 2 }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
        {[0, 120, 240].map((deg, i) => {
          const a = (deg * Math.PI) / 180
          const r = ringSize / 2
          const d = i === 0 ? 11 : 8
          return <View key={deg} style={[styles.satellite, { width: d, height: d, borderRadius: d / 2, left: r + r * Math.cos(a) - d / 2, top: r + r * Math.sin(a) - d / 2 }]} />
        })}
      </Animated.View>
    </Animated.View>
  )

  const pulse = (v: Animated.Value, p: { x: number; y: number }) => (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pulse,
        {
          left: p.x * k - 16,
          top: p.y * k - 16,
          opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.85, 0] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1.9] }) }],
        },
      ]}
    />
  )

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Illustration of a globe with two people connected by a conversation"
      style={{ width: S, height: S, opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }}
    >
      {/* far half of the orbit: hidden behind the globe where they overlap */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>{ring}</View>

      <Svg width={S} height={S} viewBox="0 0 300 300" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="body" cx="36%" cy="30%" r="85%">
            <Stop offset="0" stopColor="#7FA8FF" />
            <Stop offset="0.5" stopColor="#1D4ED8" />
            <Stop offset="1" stopColor="#08173A" />
          </RadialGradient>
          <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
            <Stop offset="0.8" stopColor="#9CC0FF" stopOpacity="0" />
            <Stop offset="0.9" stopColor="#9CC0FF" stopOpacity="0.28" />
            <Stop offset="1" stopColor="#9CC0FF" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="shade" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#000" stopOpacity="0.38" />
            <Stop offset="1" stopColor="#000" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <G>
          <Path d="M70 276a80 9 0 1 0 160 0a80 9 0 1 0 -160 0" fill="url(#shade)" />
          <Circle cx={C} cy={C} r={R + 14} fill="url(#halo)" />
          <Circle cx={C} cy={C} r={R} fill="url(#body)" />
          {dots.map((d, i) => (
            <Circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#EAF2FF" opacity={d.o} />
          ))}
          <Circle cx={C} cy={C} r={R - 0.5} fill="none" stroke="#FFFFFF" strokeOpacity={0.2} />
          <Path d={`M${PIN_A.x} ${PIN_A.y} Q ${ARC_CONTROL.x} ${ARC_CONTROL.y} ${PIN_B.x} ${PIN_B.y}`} fill="none" stroke="#FFFFFF" strokeOpacity={0.75} strokeWidth={1.6} strokeDasharray="1.5 5" strokeLinecap="round" />
          <Circle cx={PIN_A.x} cy={PIN_A.y} r={5} fill="#FFFFFF" stroke="#1D4ED8" strokeWidth={2} />
          <Circle cx={PIN_B.x} cy={PIN_B.y} r={5} fill="#FFFFFF" stroke="#1D4ED8" strokeWidth={2} />
        </G>
      </Svg>

      {pulse(pulseA, PIN_A)}
      {pulse(pulseB, PIN_B)}
      <Animated.View pointerEvents="none" style={[styles.signal, { opacity: animate ? signalOpacity : 0, transform: [{ translateX: sx }, { translateY: sy }] }]} />

      {/* near half of the orbit: only the lower half is drawn, so it passes in front of the globe */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: S / 2, height: S / 2, overflow: 'hidden' }}>
        <View style={[styles.center, { position: 'absolute', left: 0, right: 0, top: -S / 2, height: S }]}>{ring}</View>
      </View>

      <Bubble style={{ left: -S * 0.02, top: S * 0.1 }} float={7} delay={0} animate={animate}>
        <Avatar tint="#F2C14E" />
        <Text style={styles.bubbleText}>Hello, how’s your day?</Text>
      </Bubble>
      <Bubble style={{ right: -S * 0.03, top: S * 0.4, borderBottomLeftRadius: 16, borderBottomRightRadius: 5 }} float={10} delay={600} animate={animate}>
        <Text style={styles.bubbleText}>Great, thanks! And you?</Text>
        <Avatar tint="#8DB4FF" />
      </Bubble>
      <Bubble style={{ left: S * 0.05, top: S * 0.72 }} float={5} delay={1200} animate={animate}>
        <Avatar tint="#B9A7F2" />
        <View style={styles.wave}>
          {[
            [0.35, 1, 700],
            [0.5, 0.8, 520],
            [0.3, 1, 640],
            [0.55, 0.9, 480],
            [0.35, 1, 760],
          ].map(([lo, hi, ms], i) => <Bar key={i} lo={lo} hi={hi} duration={ms} animate={animate} />)}
        </View>
      </Bubble>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  satellite: { position: 'absolute', backgroundColor: '#FFFFFF', shadowColor: '#B7D0FF', shadowOpacity: 1, shadowRadius: 8, elevation: 4 },
  pulse: { position: 'absolute', width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: '#FFFFFF' },
  signal: { position: 'absolute', left: 0, top: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF', shadowColor: '#B7D0FF', shadowOpacity: 1, shadowRadius: 6, elevation: 6 },
  bubble: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderBottomLeftRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  bubbleText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
  avatar: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.8)' },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 18 },
  bar: { width: 3, height: 16, borderRadius: 2, backgroundColor: '#FFFFFF' },
})
