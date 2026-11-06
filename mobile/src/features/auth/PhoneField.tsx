import { useState, type Ref } from 'react';
import { Text, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { COUNTRIES, type Country } from '../../domain/phone';
import { useTheme } from '../../theme/ThemeProvider';
import { Field, type FieldProps } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { CountrySheet } from './CountrySheet';

/** The country the phone is set to (its locale's region), or India when it isn't one we list (specs § 4.2). */
export function regionCountry(): Country {
  let region: string | undefined;
  try {
    region = /[-_]([A-Za-z]{2})\b/.exec(Intl.DateTimeFormat().resolvedOptions().locale)?.[1]?.toUpperCase();
  } catch {
    // no Intl: fall through to India
  }
  return COUNTRIES.find((c) => c.code === region) ?? COUNTRIES[0];
}

type Props = Omit<TextInputProps, 'style' | 'value'> &
  Omit<FieldProps, 'children' | 'nativeID'> & {
    value: string;
    country: Country;
    onCountry: (country: Country) => void;
    ref?: Ref<TextInputInstance>;
  };

/**
 * Phone number: a country button (code + dial code) beside the number input, under one label. The kit's `TextField`
 * has no slot on its left edge, so this repeats its input styling (DESIGN.md § Inputs) around the button.
 */
export function PhoneField({ label, required, helper, error, success, country, onCountry, ref, onFocus, onBlur, ...input }: Props) {
  const { colors, type, space, radius } = useTheme();
  const [focused, setFocused] = useState(false);
  const [picking, setPicking] = useState(false);

  return (
    <>
    <Field label={label} required={required} helper={helper} error={error} success={success}>
      <View style={{ flexDirection: 'row', gap: space.s2 }}>
        <Press
          onPress={() => setPicking(true)}
          accessibilityLabel={`${country.code} ${country.dial}, ${country.name}. Change country`}
          scaleTo={0.98}
          style={{
            minHeight: size.control,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s2 - 2,
            paddingLeft: space.s3,
            paddingRight: space.s2 + 2,
            borderRadius: radius.sheet,
            borderWidth: size.hairline,
            borderColor: colors.controlEdge,
            backgroundColor: colors.sheet,
          }}
          pressedStyle={{ backgroundColor: colors.carbonWash }}
        >
          <Text style={[type.body, { fontFamily: type.label.fontFamily, color: colors.ink }]} numberOfLines={1}>
            {country.code} {country.dial}
          </Text>
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <Icon name="chev" size="sm" color={colors.ink2} />
          </View>
        </Press>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          aria-invalid={!!error}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
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
              flex: 1,
              minWidth: 0,
              minHeight: size.control,
              borderRadius: radius.sheet,
              borderWidth: size.hairline,
              borderColor: error ? colors.owe : focused ? colors.carbon : colors.controlEdge,
              backgroundColor: colors.sheet,
              color: colors.ink,
              paddingHorizontal: space.s3 + 2,
            },
          ]}
        />
      </View>
    </Field>
    <CountrySheet visible={picking} selected={country.code} onPick={onCountry} onClose={() => setPicking(false)} />
    </>
  );
}
