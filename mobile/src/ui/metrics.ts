import { Easing, Platform } from 'react-native';
import { motion } from '../theme/tokens';

/**
 * Component sizes from DESIGN.md's front matter and prototype/css/app.css. They live here, not on screens, so
 * screens stay literal-free (Global Constraints); colours, type, spacing and radii come from the theme.
 */
export const size = {
  control: 52, // buttons, inputs, app bar
  target: 44, // the minimum touch target: chips, answer controls, segments
  iconButton: 48, // `.icon-btn` on coarse pointers (48 dp on Android, specs § 3.6)
  fab: 60,
  tabBar: 58,
  row: 68,
  plate: 32,
  plateLg: 72,
  spaceIcon: 40,
  spaceIconSm: 32,
  stamp: 80,
  otpCell: 60,
  switchW: 52,
  switchH: 32,
  switchThumb: 26,
  badge: 24,
  dot: 8,
  grab: { w: 40, h: 5 },
  spinner: 18,
  hairline: 1,
  perf: 2,
  focusRing: 1.5,
} as const;

/** One-off glyph sizes the type scale doesn't carry (specs § 3.8): OTP digits, plate initials, the Welcome wordmark, toasts. */
export const glyph = {
  otp: 26,
  initials: 14,
  initialsLg: 28,
  hero: { fontSize: 56, lineHeight: 60, letterSpacing: -1.68 },
} as const;

/** Big system text never pushes these past 1.5× (Review Focus 5). */
export const FONT_CAP = 1.5;

export const easeOut = Easing.bezier(...motion.ease.out);
export const easeInOut = Easing.bezier(...motion.ease.inOut);
export const easeDrawer = Easing.bezier(...motion.ease.drawer);

/** react-native-web has no native animated module; everywhere else transforms and opacity run on the UI thread. */
export const nativeDriver = Platform.OS !== 'web';
