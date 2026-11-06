import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { fonts } from '../src/theme/type';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function Shell() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />
    </>
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

  // A font failure still opens the app (system serif) rather than stranding it on the splash.
  const ready = loaded || error != null;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <Shell />
        </SafeAreaProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
