import type { TextStyle } from 'react-native';

/**
 * The five static Fraunces instances (specs.md § 3.8): WONK 0, SOFT 0.
 * Text = opsz 14, Display = opsz 72 (28 px and up only). The value is both the `useFonts` key and the `fontFamily`.
 */
export const fonts = {
  textRegular: 'Fraunces-Text-Regular',
  textSemiBold: 'Fraunces-Text-SemiBold',
  textBold: 'Fraunces-Text-Bold',
  displaySemiBold: 'Fraunces-Display-SemiBold',
  displayBold: 'Fraunces-Display-Bold',
} as const;

export type TypeRole =
  | 'display'
  | 'heroFigure'
  | 'figure'
  | 'title'
  | 'wordmark'
  | 'body'
  | 'label'
  | 'serial'
  | 'stamp';

// No `fontWeight` anywhere: the weight is baked into each static file, and setting it on a custom family makes
// Android fake-bold it. No `fontVariant` either: the font has no `lnum` feature, so DESIGN.md's lining figures are
// simply its default figures. Letter-spacing is DESIGN.md's em value times the font size, in px.
export const type: Record<TypeRole, TextStyle> = {
  display: { fontFamily: fonts.displaySemiBold, fontSize: 32, lineHeight: 38, letterSpacing: -0.64 },
  heroFigure: { fontFamily: fonts.displaySemiBold, fontSize: 40, lineHeight: 48, letterSpacing: -0.8 },
  figure: { fontFamily: fonts.displaySemiBold, fontSize: 28, lineHeight: 34, letterSpacing: -0.14 },
  title: { fontFamily: fonts.textSemiBold, fontSize: 20, lineHeight: 26 },
  wordmark: { fontFamily: fonts.textBold, fontSize: 22, lineHeight: 28, letterSpacing: -0.33 },
  body: { fontFamily: fonts.textRegular, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.textSemiBold, fontSize: 13, lineHeight: 18 },
  // Tracking applies to all-caps text only (specs.md § 3.8), so these two carry the uppercase transform too.
  serial: {
    fontFamily: fonts.textSemiBold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1.04,
    textTransform: 'uppercase',
  },
  stamp: {
    fontFamily: fonts.textBold,
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 1.44,
    textTransform: 'uppercase',
  },
};
