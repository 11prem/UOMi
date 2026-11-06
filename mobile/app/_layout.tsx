import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { fonts } from '../src/theme/type';
import { queryClient } from '../src/services/queries';
import { currentServices } from '../src/services/useServices';
import { useIdleSignOut } from '../src/state/idle';
import { useSession } from '../src/state/session';
import { ConfirmHost } from '../src/ui/ConfirmDialog';
import { ToastHost } from '../src/ui/Toast';
import { useReducedMotion } from '../src/ui/useReducedMotion';

SplashScreen.preventAutoHideAsync();

/**
 * Waits for the saved session (read or failed), then `auth.restore()` before any other service call (specs § 4.1).
 * The theme is not read here: ThemeProvider keeps it on this phone.
 */
function useLaunch(): boolean {
  const hydrated = useSession((s) => s.hydrated);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    const services = currentServices();
    (async () => {
      try {
        const { mode, user: saved } = useSession.getState();
        const user = await services.auth.restore();
        if (user) useSession.getState().signedIn(user);
        // A server session that was open but didn't survive (idle too long, ended by the server) goes to Sign In.
        else useSession.getState().signedOut(undefined, mode === 'server' && saved ? '/signin' : '/welcome');
      } catch {
        // Server unreachable at launch: keep the persisted user; screens show Error with Retry (Review Focus 1).
      }
    })().finally(() => setDone(true));
  }, [hydrated]); // once per launch: a later mode switch must not restore (the user signs in again)

  return done;
}

function Shell({ fontsReady }: { fontsReady: boolean }) {
  const { colors, scheme } = useTheme();
  const reduced = useReducedMotion();
  const launched = useLaunch();
  const signedIn = useSession((s) => s.user !== null);
  const segments = useSegments();
  useIdleSignOut();

  // The tabs, and the Space page, which draws its own TabBar (`space/[id]` with nothing deeper).
  const tabBarShown = segments[0] === '(tabs)' || segments.join('/') === 'space/[id]';
  const ready = fontsReady && launched;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.ground },
          // Screens slide in like sheets pulled from a book; under reduced motion they crossfade.
          animation: reduced ? 'fade' : 'slide_from_right',
        }}
      >
        {/* Signed out, only the auth screens exist (the rest redirect to Welcome; (auth)/_layout opens Sign In over it after an idle
            or expired sign-out); signed in, the auth screens redirect to the tabs. */}
        <Stack.Protected guard={!signedIn} redirectTo="/">
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn} redirectTo="/welcome">
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="space/add-people" />
          <Stack.Screen name="space/[id]/index" />
          <Stack.Screen name="space/[id]/members" />
          <Stack.Screen name="space/[id]/settle" />
          <Stack.Screen name="space/[id]/expense-new" />
          <Stack.Screen name="expense/[id]/index" />
          <Stack.Screen name="expense/[id]/edit" />
          <Stack.Screen name="payment/[id]" />
          <Stack.Screen name="profile-edit" />
        </Stack.Protected>
      </Stack>
      <ToastHost aboveTabs={tabBarShown} />
      <ConfirmHost />
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    [fonts.textRegular]: require('../assets/fonts/Fraunces-Text-Regular.ttf'),
    [fonts.textSemiBold]: require('../assets/fonts/Fraunces-Text-SemiBold.ttf'),
    [fonts.textBold]: require('../assets/fonts/Fraunces-Text-Bold.ttf'),
    [fonts.displaySemiBold]: require('../assets/fonts/Fraunces-Display-SemiBold.ttf'),
    [fonts.displayBold]: require('../assets/fonts/Fraunces-Display-Bold.ttf'),
  });

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          {/* A font failure still opens the app (system serif) rather than stranding it on the splash. */}
          <Shell fontsReady={loaded || error != null} />
        </SafeAreaProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
