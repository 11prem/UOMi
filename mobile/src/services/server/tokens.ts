import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';

const KEY = 'uomi.server.tokens';

const StoredTokensSchema = z.object({ access: z.string(), refresh: z.string(), lastRequestAt: z.number(), idleSeconds: z.number() });
/** `lastRequestAt` (epoch ms) and `idleSeconds` (the server's idle limit) are what `restore()` checks on launch. */
export type StoredTokens = z.infer<typeof StoredTokensSchema>;

export type TokenStore = {
  get(): Promise<StoredTokens | null>;
  set(t: StoredTokens): Promise<void>;
  clear(): Promise<void>;
};

/**
 * One JSON value under `uomi.server.tokens`: the Android keystore through expo-secure-store, or AsyncStorage in a
 * browser (SecureStore has no web implementation; the web build is only for previewing server mode).
 * A value that is missing, not JSON or the wrong shape reads as "no tokens".
 */
export function defaultTokenStore(): TokenStore {
  const web = () => Platform.OS === 'web';
  return {
    async get() {
      const raw = await (web() ? AsyncStorage.getItem(KEY) : SecureStore.getItemAsync(KEY));
      if (!raw) return null;
      try {
        const parsed = StoredTokensSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    set: (t) => (web() ? AsyncStorage.setItem(KEY, JSON.stringify(t)) : SecureStore.setItemAsync(KEY, JSON.stringify(t))),
    clear: () => (web() ? AsyncStorage.removeItem(KEY) : SecureStore.deleteItemAsync(KEY)),
  };
}
