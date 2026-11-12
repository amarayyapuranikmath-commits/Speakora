/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerForegroundService } from './src/features/call/foreground';

// Must run before the app starts: notifee needs the foreground-service runner registered at load time.
registerForegroundService();

AppRegistry.registerComponent(appName, () => App);
