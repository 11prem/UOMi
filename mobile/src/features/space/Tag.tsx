import { Text } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { size } from '../../ui/metrics';

export type TagTone = 'pending' | 'disputed' | 'owner' | 'muted';

/** The outlined status tag (app.css `.tag`): Pending / Needs your answer in ochre, Disputed / Rejected in owe red, Owner in carbon. */
export function Tag({ label, tone }: { label: string; tone: TagTone }) {
  const { colors, type, space, radius } = useTheme();
  const ink = { pending: colors.pending, disputed: colors.owe, owner: colors.carbon, muted: colors.ink2 }[tone];
  return (
    <Text
      style={[
        type.label,
        {
          alignSelf: 'flex-start',
          color: ink,
          borderWidth: size.hairline,
          borderColor: ink,
          borderRadius: radius.pill,
          paddingHorizontal: space.s2,
          overflow: 'hidden',
        },
      ]}
    >
      {label}
    </Text>
  );
}
