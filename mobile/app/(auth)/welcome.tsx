import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { formatMoney } from '../../src/domain/money';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button } from '../../src/ui/Button';
import { Screen } from '../../src/ui/Screen';
import { ServerSettingsSheet } from '../../src/ui/ServerSettingsSheet';
import { Sheet } from '../../src/ui/Sheet';
import { Stamp } from '../../src/ui/Stamp';
import { Wordmark } from '../../src/ui/Wordmark';

/** Welcome (specs § 4.1): the name, what the app is, a sample bill, and the two ways in. Long-press the wordmark for server settings. */
export default function Welcome() {
  const { colors, type, space } = useTheme();
  const [server, setServer] = useState(false);

  return (
    <Screen
      footer={
        <View style={{ flex: 1, gap: space.s3 }}>
          <Button label="Create account" onPress={() => router.push('/signup')} />
          <Button variant="secondary" label="Sign in" onPress={() => router.push('/signin')} />
        </View>
      }
    >
      <View style={{ paddingTop: space.s10 }}>
        <Wordmark hero onLongPress={() => setServer(true)} longPressLabel="Server settings" />
        <Text style={[type.title, { color: colors.ink, marginTop: space.s3 }]}>Shared costs, agreed by everyone in them.</Text>

        {/* A sample bill, for looks only: a screen reader skips it (prototype `R.welcome`). */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ marginTop: space.s10 + space.s1 }}>
          <Sheet perf padded>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[type.serial, { color: colors.ink2 }]}>NO. 0412</Text>
              <Text style={[type.label, { color: colors.ink2 }]}>Today</Text>
            </View>
            <Text style={[type.body, { color: colors.ink, marginTop: space.s2 + 2 }]}>Dinner at Toit</Text>
            <Text style={[type.label, { color: colors.ink2 }]}>Paid by Swetha · split 3 ways</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: space.s10 + space.s2 }}>
              <Text style={[type.body, { color: colors.ink2 }]}>Your share</Text>
              <Text style={[type.figure, { color: colors.ink }]}>{formatMoney(48000, 'INR', { compact: true })}</Text>
            </View>
            <Stamp label="Agreed" style={{ right: space.s5, top: space.s10 + space.s1 }} />
          </Sheet>
        </View>

        <Text style={[type.label, { color: colors.ink2, marginTop: space.s6 }]}>
          Every expense is copied to the people in it. It only counts once they accept their share.
        </Text>
      </View>
      <ServerSettingsSheet visible={server} onClose={() => setServer(false)} />
    </Screen>
  );
}
