import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { radius, space, tokens, type Colors } from './tokens';
import { type } from './type';

export type ThemePreference = 'system' | 'light' | 'dark';

export type Theme = {
  colors: Colors;
  type: typeof type;
  space: typeof space;
  radius: typeof radius;
  scheme: 'light' | 'dark';
  /** What the user picked on this phone; 'system' follows the phone's scheme. */
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<Theme | null>(null);

/** The device-local choice, the same in demo and server mode (specs: follow the phone until the user picks). */
const KEY = 'uomi.theme.v1';
const isPreference = (v: string | null): v is ThemePreference => v === 'system' || v === 'light' || v === 'dark';

/** Follows the phone's scheme until `setPreference('light' | 'dark')`; the choice is saved on this phone and read back on start. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setLocal] = useState<ThemePreference>('system'); // until the saved value is read
  const picked = useRef(false);
  const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        // A pick made while the read was in flight is newer than what was stored.
        if (!picked.current && isPreference(v)) setLocal(v);
      })
      .catch(() => {}); // unreadable: keep following the phone
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    picked.current = true;
    setLocal(p);
    AsyncStorage.setItem(KEY, p).catch(() => {}); // the screen has already changed; a failed write only loses it at the next launch
  }, []);

  const value = useMemo<Theme>(
    () => ({ colors: tokens[scheme], type, space, radius, scheme, preference, setPreference }),
    [scheme, preference, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}
