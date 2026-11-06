import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { size } from '../../ui/metrics';

/**
 * A value the user can see but not change (Username, Phone number on Edit Profile): a lock beside it and a line saying
 * why. The kit has no read-only field; this is `TextField`'s box with the input swapped for text.
 */
export function ReadOnlyField({ label, value, why }: { label: string; value: string; why: string }) {
  const { colors, type, space, radius } = useTheme();
  return (
    <Field label={label} helper={why}>
      <View
        accessible
        accessibilityLabel={`${value}, read only`}
        style={{
          minHeight: size.control,
          borderRadius: radius.sheet,
          borderWidth: size.hairline,
          borderColor: colors.hair,
          backgroundColor: colors.sheet2,
          paddingHorizontal: space.s3 + 2,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.s2,
        }}
      >
        <Text style={[type.body, { color: colors.ink2, flexShrink: 1 }]}>{value}</Text>
        <Icon name="lock" size="sm" color={colors.ink2} />
      </View>
    </Field>
  );
}
