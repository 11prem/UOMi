import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { DemoHint, DemoValue } from '../../src/features/auth/DemoHint';
import { FormInput } from '../../src/features/auth/FormInput';
import { signInSchema, type SignInInput } from '../../src/features/auth/schemas';
import { AppError } from '../../src/services/errors';
import { useServices } from '../../src/services/useServices';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AppBar } from '../../src/ui/AppBar';
import { Button } from '../../src/ui/Button';
import { Screen } from '../../src/ui/Screen';

/** The copy specs § 4.4 requires, whatever wording the server sends; other failures show the service's own message. */
function signInProblem(e: unknown): string {
  if (!(e instanceof AppError)) return 'Something went wrong';
  if (e.code === 'invalid_credentials') return 'Username or password is incorrect';
  // "Too many attempts — try again in N minutes", N from `retry_after_seconds`
  const seconds = Number(e.extra?.retry_after_seconds);
  if (e.code !== 'too_many_attempts' || !(seconds > 0)) return e.message;
  const minutes = Math.ceil(seconds / 60);
  return `Too many attempts — try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

export default function SignIn() {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const { username: fromReset } = useLocalSearchParams<{ username?: string }>();
  const form = useForm<SignInInput>({ resolver: zodResolver(signInSchema), mode: 'onTouched', defaultValues: { username: fromReset ?? '', password: '' } });

  // Coming back from a password reset (this screen stays in the stack beneath it): fill the username, leave the password to type.
  useEffect(() => {
    if (!fromReset) return;
    form.setValue('username', fromReset);
    form.setValue('password', '');
    form.clearErrors();
    form.setFocus('password');
  }, [fromReset, form]);

  const submit = form.handleSubmit(async ({ username, password }) => {
    try {
      useSession.getState().signedIn(await services.auth.signIn(username, password)); // the gate moves to Home by itself
    } catch (e) {
      // One message for both fields, so it never says which was wrong (specs § 4.4)
      form.setError('password', { message: signInProblem(e) }, { shouldFocus: true });
    }
  });

  return (
    <Screen header={<AppBar title="Sign in" />}>
      <View style={{ paddingTop: space.s2, gap: space.s4 }}>
        <FormInput
          form={form}
          name="username"
          label="Username"
          autoComplete="username"
          textContentType="username"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
        />
        <FormInput form={form} name="password" password label="Password" autoComplete="current-password" textContentType="password" />
        <Button variant="text" label="Forgot password?" onPress={() => router.push('/forgot')} />
        <Button label="Sign in" onPress={submit} busy={form.formState.isSubmitting} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[type.label, { color: colors.ink2 }]}>New here?</Text>
          <Button variant="text" label="Create an account" onPress={() => router.replace('/signup')} />
        </View>
        {services.mode === 'demo' && (
          <DemoHint>
            Demo accounts: <DemoValue>kabir.r</DemoValue>, swetha.i, arun.n, meera.s, rohan.d, priya.m — password <DemoValue>demo1234</DemoValue>.
          </DemoHint>
        )}
      </View>
    </Screen>
  );
}
