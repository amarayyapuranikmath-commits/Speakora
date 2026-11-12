import { LogOut, Settings } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Avatar } from '../ui/Avatar'
import { Sheet } from '../ui/components'
import { colors, space, type } from '../ui/theme'

/**
 * The small profile control at the right of the header. It holds everything that is not a main section: Settings and Sign out.
 * Presentational part, so it can be tested without navigation or sign-in state.
 */
export function ProfileMenu({ name, onSettings, onSignOut }: { name: string; onSettings: () => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.md, minHeight: 52 }
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Account menu" accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} hitSlop={8}>
        <Avatar name={name} size={34} />
      </Pressable>
      <Sheet title={name} visible={open} onClose={() => setOpen(false)}>
        <View>
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => { setOpen(false); onSettings() }} style={row}>
            <Settings size={20} color={colors.muted} />
            <Text style={type.body}>Settings</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={() => { setOpen(false); onSignOut() }} style={row}>
            <LogOut size={20} color={colors.muted} />
            <Text style={type.body}>Sign out</Text>
          </Pressable>
        </View>
      </Sheet>
    </>
  )
}
