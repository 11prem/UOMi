import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CURRENCY_INFO } from '../../domain/money';
import { CURRENCIES, type Currency, type Preferences } from '../../domain/types';
import { qk } from '../../services/queries';
import { useServices } from '../../services/useServices';
import { useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import { fonts } from '../../theme/type';
import { size } from '../../ui/metrics';
import { isNotOnServer } from '../../ui/NotOnServer';
import { Rows } from '../../ui/Rows';
import { Segmented } from '../../ui/Segmented';
import { SpaceIcon } from '../../ui/SpaceIcon';
import { Switch } from '../../ui/Switch';
import { toast } from '../../ui/Toast';
import { Select } from './Select';

/** What server mode shows: it has no stored preferences, and may not even be reachable to ask. */
const DEFAULTS: Preferences = { defaultCurrency: 'INR', theme: 'system', notificationsOn: true };

/** app.css: the theme segmented control in its row is 132 px wide. */
const THEME_WIDTH = 132;

const THEME_CAPTION: Record<ThemePreference, string> = { system: 'Following your phone', light: 'Light', dark: 'Dark' };

function Row({ tile, title, sub, children }: { tile: ReactNode; title: string; sub: string; children: ReactNode }) {
  const { colors, type, space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: size.row, padding: space.s3 }}>
      {tile}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: colors.ink }]}>{title}</Text>
        <Text style={[type.label, { color: colors.ink2 }]}>{sub}</Text>
      </View>
      {children}
    </View>
  );
}

/** The 40 px tile that carries the currency symbol where other rows carry an icon (`.space-ico`). */
function SymbolTile({ symbol }: { symbol: string }) {
  const { colors, type, radius } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size.spaceIcon, height: size.spaceIcon, borderRadius: radius.sheet, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.carbonWash }}
    >
      <Text maxFontSizeMultiplier={1.2} style={[type.label, { fontFamily: fonts.textBold, color: colors.carbon }]} numberOfLines={1}>
        {symbol}
      </Text>
    </View>
  );
}

/**
 * Default currency, the Notifications switch and the Theme (specs § 13). `prefs` is what is stored (demo mode, which
 * renders this only once it has loaded: a write would otherwise replace what is stored with the defaults); undefined in
 * server mode. The currency and notifications are saved through the service, so they are locked in server mode. The theme
 * is the phone's own: it changes the screen at once and is saved where the service can, and stays on this phone where it can't.
 */
export function SettingsSection({ prefs, server }: { prefs: Preferences | undefined; server: boolean }) {
  const { scheme, setPreference } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const [pickedTheme, setPickedTheme] = useState<ThemePreference | null>(null);
  const save = useMutation({
    mutationFn: (p: Preferences) => services.profile.setPreferences(p),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.preferences }), // invalidate: the next read is the stored truth
  });

  const shown = save.isPending ? save.variables : (prefs ?? DEFAULTS); // the switch moves when it is tapped, not when the write returns
  const locked = server;
  const theme = pickedTheme ?? shown.theme;
  const reason = server ? 'Not available on this server yet' : undefined;

  function pickTheme(next: ThemePreference) {
    const before = theme;
    setPickedTheme(next);
    setPreference(next);
    save.mutate(
      { ...shown, theme: next },
      {
        onError: (e) => {
          if (isNotOnServer(e)) return; // nothing to save it to: the theme stays on this phone
          setPickedTheme(before);
          setPreference(before);
          toast(e.message);
        },
      },
    );
  }

  return (
    <Rows>
      <Row tile={<SymbolTile symbol={CURRENCY_INFO[shown.defaultCurrency].symbol} />} title="Default currency" sub={reason ?? 'For new spaces'}>
        <Select<Currency>
          compact
          label="Default currency"
          value={shown.defaultCurrency}
          disabled={locked}
          options={CURRENCIES.map((c) => ({ value: c, label: c, sub: `${CURRENCY_INFO[c].symbol} ${CURRENCY_INFO[c].name}` }))}
          onChange={(defaultCurrency) =>
            save.mutate({ ...shown, defaultCurrency }, { onSuccess: () => toast(`New spaces will use ${defaultCurrency}`), onError: (e) => toast(e.message) })
          }
        />
      </Row>
      <Row tile={<SpaceIcon name="bell" />} title="Notifications" sub={reason ?? 'Alerts on this phone'}>
        <Switch
          label="Notifications"
          value={shown.notificationsOn}
          disabled={locked}
          onValueChange={(notificationsOn) =>
            save.mutate({ ...shown, notificationsOn }, { onSuccess: () => toast(notificationsOn ? 'Notifications on' : 'Notifications off'), onError: (e) => toast(e.message) })
          }
        />
      </Row>
      <Row tile={<SpaceIcon name={scheme === 'dark' ? 'moon' : 'sun'} />} title="Theme" sub={THEME_CAPTION[theme]}>
        <View style={{ width: THEME_WIDTH }}>
          <Segmented<ThemePreference>
            label="Theme"
            value={theme}
            onChange={pickTheme}
            options={[
              { value: 'light', icon: 'sun', accessibilityLabel: 'Light' },
              { value: 'dark', icon: 'moon', accessibilityLabel: 'Dark' },
            ]}
          />
        </View>
      </Row>
    </Rows>
  );
}
