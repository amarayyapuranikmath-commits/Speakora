jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn(async () => 'calls'),
    displayNotification: jest.fn(async () => 'active-call'),
    stopForegroundService: jest.fn(async () => undefined),
    cancelNotification: jest.fn(async () => undefined),
    registerForegroundService: jest.fn(),
  },
  AndroidImportance: { LOW: 2 },
  AndroidForegroundServiceType: { FOREGROUND_SERVICE_TYPE_MICROPHONE: 128 },
}))
import { PermissionsAndroid, Platform } from 'react-native'
import notifee from '@notifee/react-native'
import { endCallNotification, showCallNotification } from '../src/features/call/foreground'

const mockNotifee = notifee as unknown as Record<'createChannel' | 'displayNotification' | 'stopForegroundService' | 'cancelNotification', jest.Mock>

const lastAndroid = () => (mockNotifee.displayNotification.mock.calls.at(-1) as unknown as [{ android: Record<string, unknown> }])[0].android

beforeEach(async () => {
  jest.clearAllMocks()
  Platform.OS = 'android'
  Object.defineProperty(Platform, 'Version', { value: 34, configurable: true })
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted')
  await endCallNotification() // reset the module's "service running" flag
  jest.clearAllMocks()
})

describe('call foreground service', () => {
  it('starts the service once, as a microphone-type service (type 128 = 0x80)', async () => {
    await showCallNotification(null)
    expect(mockNotifee.displayNotification).toHaveBeenCalledTimes(1)
    expect(lastAndroid()).toMatchObject({ asForegroundService: true, foregroundServiceTypes: [128], ongoing: true })
  })

  it('only updates the existing notification afterwards, so nothing tries to start a service from the background', async () => {
    await showCallNotification(null)
    await showCallNotification('Sam')
    expect(mockNotifee.displayNotification).toHaveBeenCalledTimes(2)
    expect(lastAndroid().asForegroundService).toBeUndefined()
    expect(lastAndroid().foregroundServiceTypes).toBeUndefined()
    expect(mockNotifee.displayNotification.mock.calls.at(-1)).toMatchObject([{ title: 'In a call with Sam' }])
  })

  it('stops the service when the call ends and can start again for the next call', async () => {
    await showCallNotification(null)
    await endCallNotification()
    expect(mockNotifee.stopForegroundService).toHaveBeenCalled()
    expect(mockNotifee.cancelNotification).toHaveBeenCalledWith('active-call')
    await showCallNotification(null)
    expect(lastAndroid().asForegroundService).toBe(true)
  })

  it('asks for notification permission on Android 13+ before the first start', async () => {
    Object.defineProperty(Platform, 'Version', { value: 34, configurable: true })
    await showCallNotification(null)
    expect(PermissionsAndroid.request).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS')
  })

  it('never throws when the notification cannot be shown, and retries the start next time', async () => {
    mockNotifee.displayNotification.mockRejectedValueOnce(new Error('not allowed'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(showCallNotification(null)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    await showCallNotification(null)
    expect(lastAndroid().asForegroundService).toBe(true)
    warn.mockRestore()
  })
})
