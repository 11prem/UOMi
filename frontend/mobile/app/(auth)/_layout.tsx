import { useEffect } from 'react';
import { router, Stack } from 'expo-router';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useReducedMotion } from '../../src/ui/useReducedMotion';

// Welcome is this stack's anchor: a link straight to another auth screen keeps Welcome beneath it.
export const unstable_settings = { anchor: 'welcome' };

/** The signed-out screens. Every sign-out redirects here to Welcome. */
export default function AuthLayout() {
  const { colors } = useTheme();
  const reduced = useReducedMotion();

  // This layout mounts fresh on each sign-out. After an idle sign-out, or a server session that expired while the app
  // was closed, open Sign In over Welcome (design § 4.4), so Back still reaches Welcome. (The gate's own redirect
  // can't add Welcome beneath its target, so it always lands on Welcome and this pushes the rest.)
  useEffect(() => {
    if (useSession.getState().landing === '/signin') router.push('/signin');
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground }, animation: reduced ? 'fade' : 'slide_from_right' }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="verify" />
      <Stack.Screen name="signin" />
      <Stack.Screen name="forgot" />
      <Stack.Screen name="forgot-otp" />
      <Stack.Screen name="reset" />
    </Stack>
  );
}
