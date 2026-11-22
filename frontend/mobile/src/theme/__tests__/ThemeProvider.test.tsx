import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../ThemeProvider';
import { tokens } from '../tokens';

// jest-expo replaces useColorScheme with a jest.fn that returns 'light'.
const setSystem = (scheme: 'light' | 'dark') => jest.mocked(useColorScheme).mockReturnValue(scheme);

beforeEach(() => AsyncStorage.clear()); // the choice is saved on the phone: start each test without one
afterEach(() => jest.restoreAllMocks());

describe('useTheme', () => {
  it('follows the system scheme until a preference is set', async () => {
    setSystem('dark');
    const { result } = await renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.scheme).toBe('dark');
    expect(result.current.colors).toBe(tokens.dark);

    await act(async () => result.current.setPreference('light'));
    expect(result.current.scheme).toBe('light');
    expect(result.current.colors).toBe(tokens.light);

    await act(async () => result.current.setPreference('system'));
    expect(result.current.scheme).toBe('dark');
  });

  it('keeps the picked preference on this phone across launches', async () => {
    setSystem('light');
    const first = await renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(first.result.current.preference).toBe('system');
    await act(async () => first.result.current.setPreference('dark'));
    await first.unmount();

    const again = await renderHook(() => useTheme(), { wrapper: ThemeProvider }); // same storage, fresh provider
    await waitFor(() => expect(again.result.current.preference).toBe('dark'));
    expect(again.result.current.scheme).toBe('dark');
    expect(await AsyncStorage.getItem('uomi.theme.v1')).toBe('dark');
  });

  it('follows the system until the saved value is read, and a pick made meanwhile wins', async () => {
    setSystem('dark');
    let read!: (v: string | null) => void;
    jest.spyOn(AsyncStorage, 'getItem').mockReturnValueOnce(new Promise((r) => (read = r)));
    const { result } = await renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current).toMatchObject({ preference: 'system', scheme: 'dark' }); // nothing read yet

    await act(async () => result.current.setPreference('light'));
    await act(async () => read('dark')); // the stored value arrives after the pick
    expect(result.current).toMatchObject({ preference: 'light', scheme: 'light' });
  });

  it('exposes the type, space and radius scales', async () => {
    setSystem('light');
    const { result } = await renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.type.body.fontSize).toBe(16);
    expect(result.current.space.s4).toBe(16);
    expect(result.current.radius.sheet).toBe(6);
  });

  it('throws outside a ThemeProvider', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(renderHook(() => useTheme())).rejects.toThrow('ThemeProvider');
  });
});
