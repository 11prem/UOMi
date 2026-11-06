import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CURRENCY_INFO } from '../../domain/money';
import { CURRENCIES, type Currency, type Space } from '../../domain/types';
import { useServices } from '../../services/useServices';
import { useTheme } from '../../theme/ThemeProvider';
import { BottomSheet } from '../../ui/BottomSheet';
import { Icon } from '../../ui/Icon';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { Rows } from '../../ui/Rows';
import { Spinner } from '../../ui/Spinner';
import { toast } from '../../ui/Toast';
import { errorText, refreshMoney } from '../expense/refresh';

/** The space's currency (specs § 10): the owner picks one while the space has no expenses. */
export function CurrencySheet({ visible, space: s, onClose }: { visible: boolean; space: Space; onClose: () => void }) {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<Currency | null>(null);

  async function pick(c: Currency) {
    if (saving) return;
    if (c === s.currency) return onClose();
    setSaving(c);
    try {
      await services.spaces.update(s.id, { currency: c });
    } catch (e) {
      setSaving(null);
      return toast(errorText(e));
    }
    void refreshMoney(queryClient);
    toast(`Currency changed to ${c}`);
    setSaving(null);
    onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Currency">
      <View accessibilityRole="radiogroup" accessibilityLabel="Currency">
        <Rows nested>
          {CURRENCIES.map((c) => {
            const on = c === s.currency;
            return (
              <Press
                key={c}
                accessibilityRole="radio"
                accessibilityState={{ checked: on, busy: saving === c }}
                accessibilityLabel={`${CURRENCY_INFO[c].name}, ${c}`}
                onPress={() => pick(c)}
                scaleTo={1}
                style={{ minHeight: size.control, paddingHorizontal: space.s3, flexDirection: 'row', alignItems: 'center', gap: space.s3 }}
                pressedStyle={{ backgroundColor: colors.carbonWash }}
              >
                <Text style={[type.body, { flex: 1, color: colors.ink }]}>
                  {CURRENCY_INFO[c].symbol} {CURRENCY_INFO[c].name}
                </Text>
                <Text style={[type.label, { color: colors.ink2 }]}>{c}</Text>
                {saving === c ? <Spinner color={colors.carbon} /> : on && <Icon name="check" size="sm" color={colors.carbon} />}
              </Press>
            );
          })}
        </Rows>
      </View>
    </BottomSheet>
  );
}
