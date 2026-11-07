import { useState, type Ref } from 'react';
import { Text, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { CURRENCY_INFO } from '../../domain/money';
import type { Currency } from '../../domain/types';
import { useTheme } from '../../theme/ThemeProvider';
import { Field } from '../../ui/Field';
import { FONT_CAP } from '../../ui/metrics';
import { cleanDecimal } from './amountText';
import { FORM } from './metrics';

export type AmountFieldProps = Omit<TextInputProps, 'style' | 'onChangeText'> & {
  label: string;
  currency: Currency;
  required?: boolean;
  helper?: string;
  error?: string;
  /** Gets the filtered text: digits and one point, at most two decimals. */
  onChangeText: (text: string) => void;
  ref?: Ref<TextInputInstance>;
};

/**
 * The amount entry (DESIGN.md § Inputs, Amount field; app.css `.amount-input`): a borderless 40 px carbon hero figure
 * after the currency symbol at figure size, over a 2 px strong-hairline underline that turns carbon on focus, owe on
 * error. Decimal keypad. Big system text stops at 1.5× here: a 40 px figure past that would only scroll sideways.
 */
export function AmountField({ label, currency, required, helper, error, onChangeText, ref, onFocus, onBlur, ...input }: AmountFieldProps) {
  const { colors, type, space } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} required={required} helper={helper} error={error}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s2 - 2,
          paddingTop: space.s2 - 2,
          paddingBottom: space.s1,
          borderBottomWidth: FORM.underline,
          borderBottomColor: error ? colors.owe : focused ? colors.carbon : colors.hairStrong,
        }}
      >
        <Text style={[type.figure, { color: colors.carbon }]} maxFontSizeMultiplier={FONT_CAP} accessibilityElementsHidden importantForAccessibility="no">
          {CURRENCY_INFO[currency].symbol}
        </Text>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          aria-invalid={!!error}
          accessibilityHint={error || undefined}
          inputMode="decimal"
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.ink2}
          selectionColor={colors.selection}
          cursorColor={colors.carbon}
          maxFontSizeMultiplier={FONT_CAP}
          maxLength={12 /* 99,99,999.99, the per-expense limit with grouping commas */}
          {...input}
          onChangeText={(t) => onChangeText(cleanDecimal(t))}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[type.heroFigure, { flex: 1, minWidth: 0, padding: 0, color: colors.carbon }]}
        />
      </View>
    </Field>
  );
}
