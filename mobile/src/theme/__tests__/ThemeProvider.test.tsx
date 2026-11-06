import { useColorScheme } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../ThemeProvider';
import { tokens } from '../tokens';

// jest-expo replaces useColorScheme with a jest.fn that returns 'light'.
const setSystem = (scheme: 'light' | 'dark') => jest.mocked(useColorScheme).mockReturnValue(scheme);

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
