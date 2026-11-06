import { useState, type ReactNode, type Ref } from 'react';
import { TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Field, type FieldProps } from './Field';
import { size } from './metrics';

export type TextFieldProps = Omit<TextInputProps, 'style'> &
  Omit<FieldProps, 'children' | 'nativeID'> & {
    /** A control inside the right edge of the input (the password eye). */
    right?: ReactNode;
    /** For focusing the first invalid field on submit (specs § 3.3). */
    ref?: Ref<TextInputInstance>;
  };

/** A 52 px input in a `Field`: control-edge border, carbon on focus, owe on error, carbon caret (DESIGN.md § Inputs). */
export function TextField({ label, required, helper, error, success, right, ref, onFocus, onBlur, ...input }: TextFieldProps) {
  const { colors, type, space, radius } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} required={required} helper={helper} error={error} success={success}>
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          aria-invalid={!!error}
          placeholderTextColor={colors.ink2}
          selectionColor={colors.selection}
          cursorColor={colors.carbon}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            type.body,
            {
              minHeight: size.control,
              borderRadius: radius.sheet,
              borderWidth: size.hairline,
              borderColor: error ? colors.owe : focused ? colors.carbon : colors.controlEdge,
              backgroundColor: colors.sheet,
              color: colors.ink,
              paddingHorizontal: space.s3 + 2, // 14 px (app.css `.input`)
              paddingRight: right ? size.control : undefined,
            },
          ]}
        />
        {right && <View style={{ position: 'absolute', right: space.s1 / 2 }}>{right}</View>}
      </View>
    </Field>
  );
}
