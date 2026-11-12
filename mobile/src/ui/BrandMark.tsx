import { Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { APP_NAME } from '../config'
import { colors, isDark, palettes } from './theme'

// The Speakora mark: a speech bubble holding an S made of two stacked arcs. Same geometry as design/logo/*.svg (built by design/build-logo.py)
// and the website's LogoMark, so the two platforms show one identity.
const BUBBLE = 'M18 4H46A14 14 0 0 1 60 18V38A14 14 0 0 1 46 52H28L13 61L18 52A14 14 0 0 1 4 38V18A14 14 0 0 1 18 4Z'
const S_TOP = 'M38.55 15.41A8 8 0 1 0 32 28'
const S_BOTTOM = 'M32 28A8 8 0 1 1 25.45 40.59'
const BLUE = '#2F6BFF'

/** `onDark`: the white-bubble version, for navy or other dark backgrounds (it is also used whenever the app is in its dark theme). */
export function BrandMark({ size = 36, onDark = false }: { size?: number; onDark?: boolean }) {
  const whiteBubble = onDark || isDark()
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={BUBBLE} fill={whiteBubble ? '#FFFFFF' : colors.navy} />
      <Path d={S_TOP} fill="none" stroke={whiteBubble ? palettes.light.navy : '#FFFFFF'} strokeWidth={8} strokeLinecap="round" />
      <Path d={S_BOTTOM} fill="none" stroke={BLUE} strokeWidth={8} strokeLinecap="round" />
    </Svg>
  )
}

/** Mark and name, for the top of the sign-in and sign-up screens. */
export function BrandRow() {
  return (
    <View accessibilityRole="header" accessibilityLabel={APP_NAME} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 }}>
      <BrandMark size={32} />
      <Text style={{ fontSize: 20, fontWeight: '700', letterSpacing: -0.3, color: colors.navy }}>{APP_NAME}</Text>
    </View>
  )
}
