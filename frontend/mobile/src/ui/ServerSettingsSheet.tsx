import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { REQUEST_TIMEOUT_MS } from '../services/server/http';
import { DEFAULT_SERVER_URL, useSession } from '../state/session';
import { useTheme } from '../theme/ThemeProvider';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { TextField } from './TextField';
import { toast } from './Toast';

const URL_RULE = /^https?:\/\/\S+$/;

type Check = { state: 'idle' | 'busy' } | { state: 'ok' } | { state: 'fail' };

/**
 * The backend's address, with **Test connection** (`GET {url}/health`) and **Save**. Saving a different address calls
 * `setServerUrl`, which signs out and clears the cache (design § 4.4). Opened by long-pressing the Welcome wordmark.
 * The test waits as long as a request does, because a hosted server can take most of a minute to wake up.
 */
export function ServerSettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, type, space } = useTheme();
  const saved = useSession((s) => s.serverUrl);
  const [url, setUrl] = useState(saved);
  const [error, setError] = useState<string>();
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!visible) {
      abort.current?.abort(); // closing the sheet gives up on a test still waiting
      return;
    }
    setUrl(saved);
    setError(undefined);
    setCheck({ state: 'idle' });
  }, [visible]); // start from the saved address each time it opens

  const base = url.trim().replace(/\/+$/, '');
  const valid = () => {
    const ok = URL_RULE.test(base);
    setError(ok ? undefined : 'Enter a URL that starts with http:// or https://');
    return ok;
  };

  async function testConnection() {
    if (!valid()) return;
    abort.current?.abort();
    const controller = (abort.current = new AbortController());
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setCheck({ state: 'busy' });
    try {
      const res = await fetch(`${base}/health`, { signal: controller.signal });
      if (abort.current === controller) setCheck({ state: res.ok ? 'ok' : 'fail' });
    } catch {
      if (abort.current === controller) setCheck({ state: 'fail' }); // unreachable, or the timeout
    } finally {
      clearTimeout(timer);
    }
  }

  async function save() {
    if (!valid()) return;
    if (base !== saved) {
      setSaving(true);
      try {
        await useSession.getState().setServerUrl(base);
      } finally {
        setSaving(false);
      }
      toast('Server address saved');
    }
    onClose();
  }

  const result = check.state === 'ok' ? 'Connected' : check.state === 'fail' ? 'Couldn’t reach the server' : undefined;
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Server">
      <View style={{ gap: space.s4 }}>
        <Text style={[type.label, { color: colors.ink2, fontFamily: type.body.fontFamily }]}>
          The UOMi server this app talks to. Changing it signs you out and clears what this phone has loaded.
        </Text>
        <TextField
          label="Server URL"
          value={url}
          onChangeText={(t) => {
            setUrl(t);
            setCheck({ state: 'idle' });
          }}
          onBlur={() => url && valid()}
          placeholder={DEFAULT_SERVER_URL}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="url"
          error={error ?? (check.state === 'fail' ? result : undefined)}
          success={check.state === 'ok' ? result : undefined}
        />
        {check.state === 'busy' && (
          <Text accessibilityLiveRegion="polite" style={[type.label, { color: colors.ink2, fontFamily: type.body.fontFamily }]}>
            Connecting… a server that was asleep can take up to a minute to answer.
          </Text>
        )}
        <Button variant="secondary" label="Test connection" busy={check.state === 'busy'} onPress={testConnection} />
        <Button label="Save" busy={saving} onPress={save} />
      </View>
    </BottomSheet>
  );
}
