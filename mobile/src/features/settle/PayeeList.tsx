import { Text, View } from 'react-native';
import { formatMoney } from '../../domain/money';
import type { Currency, User } from '../../domain/types';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/Icon';
import { MemberPlate } from '../../ui/MemberPlate';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { Rows } from '../../ui/Rows';
import { FORM } from '../expense/metrics';

export type Payee = { user: User; maxMinor: number };

/** "Pay to" (specs § 9; app.js `R.settle`): the people the viewer owes here as radio rows, each with the most they can pay now. */
export function PayeeList({ payees, currency, selected, onSelect }: { payees: Payee[]; currency: Currency; selected: string | null; onSelect: (id: string) => void }) {
  const { colors, type, space } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Pay to">
      <Rows>
        {payees.map(({ user, maxMinor }) => {
          const on = user.id === selected;
          const owe = `You owe ${formatMoney(maxMinor, currency)}`;
          return (
            <Press
              key={user.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${user.name}, you owe ${formatMoney(maxMinor, currency)}`}
              onPress={() => onSelect(user.id)}
              scaleTo={1}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: size.row, padding: space.s3 }}
              pressedStyle={{ backgroundColor: colors.carbonWash }}
            >
              <MemberPlate user={user} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.body, { color: colors.ink }]}>{user.name}</Text>
                <Text style={[type.label, { color: colors.ink2, marginTop: 2 }]}>{owe}</Text>
              </View>
              <View
                style={{
                  width: FORM.check,
                  height: FORM.check,
                  borderRadius: FORM.check / 2,
                  borderWidth: size.focusRing,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderColor: on ? colors.carbon : colors.controlEdge,
                  backgroundColor: on ? colors.carbon : 'transparent',
                }}
              >
                {on && <Icon name="check" size="sm" color={colors.onCarbon} />}
              </View>
            </Press>
          );
        })}
      </Rows>
    </View>
  );
}
