import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type FieldProps = {
  label: string;
  required?: boolean;
  /** Grey hint under the control. Replaced by `error` (owe, 600) or `success` (owed, 600). The line is always reserved. */
  helper?: string;
  error?: string;
  success?: string;
  nativeID?: string;
  children: ReactNode;
};

/** A visible label, the control, and a helper/error line below it (specs § 3.3; `.field` in app.css). */
export function Field({ label, required, helper, error, success, nativeID, children }: FieldProps) {
  const { colors, type, space } = useTheme();
  const line = error || success || helper || '';
  return (
    <View style={{ gap: space.s2 - 2 /* 6 px label-to-control (DESIGN.md § Layout) */ }}>
      <Text style={[type.label, { color: colors.ink }]} nativeID={nativeID}>
        {label}
        {required && <Text style={{ color: colors.owe }} accessibilityElementsHidden importantForAccessibility="no">{' *'}</Text>}
      </Text>
      {children}
      <Text
        accessibilityLiveRegion="polite"
        style={[
          type.label,
          { minHeight: type.label.lineHeight, fontFamily: error || success ? type.label.fontFamily : type.body.fontFamily },
          { color: error ? colors.owe : success ? colors.owed : colors.ink2 },
        ]}
      >
        {line}
      </Text>
    </View>
  );
}
