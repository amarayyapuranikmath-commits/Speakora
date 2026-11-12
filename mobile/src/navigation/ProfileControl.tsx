import { useNavigation } from '@react-navigation/native'
import { useAuth } from '../features/auth/AuthContext'
import { useCall } from '../features/call/CallContext'
import { ProfileMenu } from './ProfileMenu'

/** Wires the menu to the signed-in user, the Settings screen and sign-out (which also leaves any call or search). */
export function ProfileControl() {
  const { user, logout } = useAuth()
  const call = useCall()
  const nav = useNavigation<any>()
  return (
    <ProfileMenu
      name={user?.displayName ?? 'Account'}
      onSettings={() => nav.getParent()?.navigate('Settings') ?? nav.navigate('Settings')}
      onSignOut={() => {
        call.reset()
        void logout()
      }}
    />
  )
}
