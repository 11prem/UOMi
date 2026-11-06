import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSession, type Mode } from '../state/session';
import { useTheme } from '../theme/ThemeProvider';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Segmented } from './Segmented';
import { TextField } from './TextField';
import { toast } from './Toast';

const URL_RULE = /^https?:\/\//;
const HEALTH_TIMEOUT_MS = 5000;

type Check = { state: 'idle' | 'busy' } | { state: 'ok' } | { state: 'fail' };

/**
 * Mode (Demo / Server), the server URL and **Test connection** (`GET {url}/health`). **Save** calls `setMode`, which
 * signs out and clears the cache (design § 4.4). Opened by long-pressing the Welcome wordmark and from the debug menu.
 */
export function ServerSettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, type, space } = useTheme();
  const session = useSession();
  const [mode, setMode] = useState<Mode>(session.mode);
  const [url, setUrl] = useState(session.serverUrl);
  const [error, setError] = useState<string>();
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMode(session.mode);
    setUrl(session.serverUrl);
    setError(undefined);
    setCheck({ state: 'idle' });
  }, [visible]); // start from the saved settings each time it opens

  const base = url.trim().replace(/\/+$/, '');
  const valid = () => {
    const ok = URL_RULE.test(base);
    setError(ok ? undefined : 'Enter a URL that starts with http:// or https://');
    return ok;
  };

  async function testConnection() {
    if (!valid()) return;
    setCheck({ state: 'busy' });
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/health`, { signal: abort.signal });
      setCheck({ state: res.ok ? 'ok' : 'fail' });
    } catch {
      setCheck({ state: 'fail' });
    } finally {
      clearTimeout(timer);
    }
  }

  async function save() {
    if (mode === 'server' && !valid()) return;
    const nextUrl = mode === 'server' ? base : session.serverUrl;
    if (mode !== session.mode || nextUrl !== session.serverUrl) {
      setSaving(true);
      try {
        await session.setMode(mode, nextUrl);
      } finally {
        setSaving(false);
      }
      toast(mode === 'server' ? 'Switched to Server mode' : 'Switched to Demo mode');
    }
    onClose();
  }

  const result = check.state === 'ok' ? 'Connected' : check.state === 'fail' ? 'Couldn’t reach the server' : undefined;
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Server">
      <View style={{ gap: space.s4 }}>
        <Segmented
          label="Mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'demo', label: 'Demo' },
            { value: 'server', label: 'Server' },
          ]}
        />
        <Text style={[type.label, { color: colors.ink2, fontFamily: type.body.fontFamily }]}>
          {mode === 'demo'
            ? 'Everything stays on this phone, with sample people and spaces.'
            : 'Use a UOMi backend on your network. Switching signs you out and clears what this phone has loaded.'}
        </Text>
        {mode === 'server' && (
          <>
            <TextField
              label="Server URL"
              value={url}
              onChangeText={(t) => {
                setUrl(t);
                setCheck({ state: 'idle' });
              }}
              onBlur={() => url && valid()}
              placeholder="http://192.168.1.20:8000"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              error={error ?? (check.state === 'fail' ? result : undefined)}
              success={check.state === 'ok' ? result : undefined}
            />
            <Button variant="secondary" label="Test connection" busy={check.state === 'busy'} onPress={testConnection} />
          </>
        )}
        <Button label="Save" busy={saving} onPress={save} />
      </View>
    </BottomSheet>
  );
}
