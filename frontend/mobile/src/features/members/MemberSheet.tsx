import { Text, View } from 'react-native';
import type { User } from '../../domain/types';
import { useTheme } from '../../theme/ThemeProvider';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { MemberPlate } from '../../ui/MemberPlate';
import { firstName } from '../space/format';

export type MemberSheetProps = {
  visible: boolean;
  member: User | null;
  /** "@rohan.d · you owe ₹386.67" */
  sub: string;
  canRemove: boolean;
  onRemove: () => void;
  onClose: () => void;
};

/**
 * The ⋯ menu on a member row (specs § 10): the owner's Remove, disabled with "Settle up first" while any pairwise balance
 * of the member is open (with anyone, not only the viewer); the service enforces the same rule and its refusal is toasted.
 */
export function MemberSheet({ visible, member, sub, canRemove, onRemove, onClose }: MemberSheetProps) {
  const { colors, type, space } = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={member?.name ?? ''}>
      {member && (
        <View style={{ gap: space.s3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3 }}>
            <MemberPlate user={member} />
            <Text style={[type.body, { flex: 1, color: colors.ink2 }]}>{sub}</Text>
          </View>
          <Button variant="danger" icon="x" label="Remove from space" onPress={onRemove} disabled={!canRemove} />
          {!canRemove && (
            <Text style={[type.label, { color: colors.ink2 }]}>Settle up first — {firstName(member.name)} has open balances here.</Text>
          )}
        </View>
      )}
    </BottomSheet>
  );
}
