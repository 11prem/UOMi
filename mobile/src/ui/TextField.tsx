import { useState, type ReactNode, type Ref } from 'react';
import { TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Field, type FieldProps } from './Field';
import { size } from './metrics';

export type TextFieldProps = Omit<TextInputProps, 'style'> &
  Omit<FieldProps, 'children' | 'nativeID'> & {
    /** Content inside the border, before the input (the phone field's country prefix). */
    left?: ReactNode;
    /** A control inside the right edge of the input (the password eye). */
    right?: ReactNode;
    /** For focusing the first invalid field on submit (specs § 3.3). */
    ref?: Ref<TextInputInstance>;
  };

/** A 52 px input in a `Field`: control-edge border, carbon on focus, owe on error, carbon caret (DESIGN.md § Inputs). */
export function TextField({ label, required, helper, error, success, left, right, ref, onFocus, onBlur, ...input }: TextFieldProps) {
  const { colors, type, space, radius } = useTheme();
  const [focused, setFocused] = useState(false);
  const border = {
    minHeight: size.control,
    borderRadius: radius.sheet,
    borderWidth: size.hairline,
    borderColor: error ? colors.owe : focused ? colors.carbon : colors.controlEdge,
    backgroundColor: colors.sheet,
  };
  const padding = {
    paddingHorizontal: space.s3 + 2, // 14 px (app.css `.input`)
    paddingRight: right ? size.control : undefined,
  };
  return (
    <Field label={label} required={required} helper={helper} error={error} success={success}>
      {/* With a `left` slot the border moves to a row around the slot and the input; without one, the input draws it. */}
      <View style={left ? [border, { flexDirection: 'row', alignItems: 'center' }] : { justifyContent: 'center' }}>
        {left}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          aria-invalid={!!error} // web only; on a phone the hint carries the error
          accessibilityHint={error || undefined}
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
            left
              ? { flex: 1, alignSelf: 'stretch', color: colors.ink, ...padding, paddingLeft: space.s2 }
              : { ...border, color: colors.ink, ...padding },
          ]}
        />
        {right && <View style={{ position: 'absolute', right: space.s1 / 2 }}>{right}</View>}
      </View>
    </Field>
  );
}
