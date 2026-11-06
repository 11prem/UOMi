import { useEffect, useRef, useState, type Ref } from 'react';
import { Animated, Platform, Pressable, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { fonts } from '../theme/type';
import { FONT_CAP, easeOut, glyph, nativeDriver, size } from './metrics';
import { useReducedMotion } from './useReducedMotion';

export type OtpInputProps = {
  value: string;
  onChange: (code: string) => void;
  /** Turns the cells owe-red; bump `shakeKey` alongside it to shake the row ±6 px (no shake under reduced motion). */
  error?: boolean;
  shakeKey?: number;
  autoFocus?: boolean;
  /** Called once six digits are in. */
  onComplete?: (code: string) => void;
  ref?: Ref<TextInputInstance>;
};

const LENGTH = 6;

/**
 * Six 60 px cells over one real input, so paste and SMS / one-time-code autofill fill all six at once (specs § 3.4).
 * Clearing `value` puts the caret back on the first cell. Digits are capped at 1.5× font scale (Review Focus 5).
 */
export function OtpInput({ value, onChange, error, shakeKey, autoFocus, onComplete, ref }: OtpInputProps) {
  const { colors, space, radius } = useTheme();
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const inner = useRef<TextInputInstance>(null);
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!shakeKey || reduced) return;
    const step = (toValue: number) => Animated.timing(shake, { toValue, duration: 72, easing: easeOut, useNativeDriver: nativeDriver });
    Animated.sequence([step(-6), step(6), step(-6), step(6), step(0)]).start(); // 360 ms, as `@keyframes shake`
  }, [shakeKey, reduced, shake]);

  const setRefs = (node: TextInputInstance | null) => {
    inner.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <Pressable onPress={() => inner.current?.focus()} accessible={false}>
      <Animated.View style={{ flexDirection: 'row', gap: space.s2, transform: [{ translateX: shake }] }}>
        {Array.from({ length: LENGTH }, (_, i) => {
          const active = focused && (i === value.length || (i === LENGTH - 1 && value.length === LENGTH));
          return (
            <View
              key={i}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={{
                flex: 1,
                height: size.otpCell,
                borderRadius: radius.sheet,
                borderWidth: size.hairline,
                borderColor: error ? colors.owe : active ? colors.carbon : colors.controlEdge,
                backgroundColor: colors.sheet,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text maxFontSizeMultiplier={FONT_CAP} style={{ fontFamily: fonts.displaySemiBold, fontSize: glyph.otp, color: colors.carbon }}>
                {value[i] ?? ''}
              </Text>
            </View>
          );
        })}
      </Animated.View>
      <TextInput
        ref={setRefs}
        value={value}
        onChangeText={(t) => {
          const code = t.replace(/\D/g, '').slice(0, LENGTH);
          onChange(code);
          if (code.length === LENGTH) onComplete?.(code);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        textContentType="oneTimeCode"
        maxLength={LENGTH}
        caretHidden
        contextMenuHidden={false}
        maxFontSizeMultiplier={FONT_CAP}
        accessibilityLabel="6-digit code"
        aria-invalid={!!error}
        // Invisible but laid over the cells, so taps, long-press paste and autofill reach the real input.
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.01, color: 'transparent' }}
      />
    </Pressable>
  );
}
