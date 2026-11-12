import { Text, View } from 'react-native'
import { Screen } from '../../ui/components'
import { space, type } from '../../ui/theme'

/** Shown only in debug builds for sections that are not built yet. It never pretends the section works. */
export function NotAvailableScreen({ name }: { name: string }) {
  return (
    <Screen>
      <View style={{ paddingVertical: space.xxl }}>
        <Text accessibilityRole="header" style={type.title}>{name}</Text>
        <Text style={[type.body, { marginTop: space.md }]}>This section is not available yet. It is shown here only so the navigation can be reviewed.</Text>
      </View>
    </Screen>
  )
}
