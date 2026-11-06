import { Text, View } from 'react-native';
import { relDate } from '../../domain/dates';
import type { AppNotification } from '../../domain/types';
import { useTheme } from '../../theme/ThemeProvider';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { SpaceIcon } from '../../ui/SpaceIcon';
import { ICON, subOf } from './model';

/**
 * One earlier notification (app.js `R.notifs` `item`): an icon for its type, the message, the space and the age. Unread
 * ones are tinted, set a weight heavier and carry a dot (and the word, for a screen reader: colour is never the only signal).
 */
export function NotificationRow({ n, onOpen }: { n: AppNotification; onOpen: (n: AppNotification) => void }) {
  const { colors, type, space } = useTheme();
  const sub = [subOf(n), relDate(n.createdAt)].filter(Boolean).join(' · ');
  return (
    <Press
      onPress={() => onOpen(n)}
      accessibilityLabel={[n.message, sub, n.read ? null : 'Unread'].filter(Boolean).join(', ')}
      scaleTo={1}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: size.row, padding: space.s3 }, !n.read && { backgroundColor: colors.carbonWash }]}
      pressedStyle={{ backgroundColor: colors.carbonWash }}
    >
      <SpaceIcon name={ICON[n.type]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: colors.ink, fontFamily: n.read ? type.body.fontFamily : type.label.fontFamily }]}>{n.message}</Text>
        <Text style={[type.label, { color: colors.ink2, marginTop: space.s1 / 2 }]}>{sub}</Text>
      </View>
      {!n.read && <View style={{ width: size.dot, height: size.dot, borderRadius: size.dot / 2, backgroundColor: colors.carbon }} />}
    </Press>
  );
}
