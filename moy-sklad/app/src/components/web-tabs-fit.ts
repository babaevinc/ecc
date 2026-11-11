// Web preview only: Expo Router's top tab bar pads every tab by 20px, so five Russian labels do not
// fit a phone-wide window and the last tab scrolls out of sight. Tighter padding makes all five fit.
import { Platform } from 'react-native';

if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('ms-tabs-fit')) {
  const style = document.createElement('style');
  style.id = 'ms-tabs-fit';
  style.textContent = ':root{--expo-router-tabs-font-size:14px}'
    + '[class*="navigationMenuRoot"]{max-width:calc(100vw - 16px)}'
    + '[class*="navigationMenuTrigger"]{padding:0 10px}';
  document.head.appendChild(style);
}
