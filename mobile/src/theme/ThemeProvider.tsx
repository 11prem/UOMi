import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { radius, space, tokens, type Colors } from './tokens';
import { type } from './type';

export type ThemePreference = 'system' | 'light' | 'dark';

export type Theme = {
  colors: Colors;
  type: typeof type;
  space: typeof space;
  radius: typeof radius;
  scheme: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<Theme | null>(null);

/** Follows the phone's scheme until `setPreference('light' | 'dark')` is called. Not persisted here. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>('system');
  const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<Theme>(
    () => ({ colors: tokens[scheme], type, space, radius, scheme, setPreference }),
    [scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}
