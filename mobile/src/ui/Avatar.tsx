import { Text, View } from 'react-native'
import { AVATAR_LIGHTNESS, AVATAR_SATURATION, hashHue, initials } from '../lib/initials'

/** A round picture for a person: their initials on a colour that is the same every time for the same name. */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hashHue(name)}, ${AVATAR_SATURATION}%, ${AVATAR_LIGHTNESS}%)`, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: Math.round(size * 0.38) }}>{initials(name)}</Text>
    </View>
  )
}
