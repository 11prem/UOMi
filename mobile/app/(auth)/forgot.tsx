import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { normalizeEmail } from '../../src/domain/email';
import { FormInput } from '../../src/features/auth/FormInput';
import { forgotSchema, type ForgotInput } from '../../src/features/auth/schemas';
import { AppError } from '../../src/services/errors';
import { useServices } from '../../src/services/useServices';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AppBar } from '../../src/ui/AppBar';
import { Button } from '../../src/ui/Button';
import { Screen } from '../../src/ui/Screen';
import { toast } from '../../src/ui/Toast';

/** Forgot password, step 1 (specs § 4.5a): the username and the email on that account; the code goes to that email. */
export default function Forgot() {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const form = useForm<ForgotInput>({ resolver: zodResolver(forgotSchema), mode: 'onTouched', defaultValues: { username: '', email: '' } });

  const submit = form.handleSubmit(async ({ username, email }) => {
    try {
      const { resetId, maskedEmail } = await services.auth.requestResetOtp(username, normalizeEmail(email));
      router.push({ pathname: '/forgot-otp', params: { resetId, maskedEmail } });
    } catch (e) {
      if (e instanceof AppError && e.code === 'unknown_username') form.setError('username', { message: e.message }, { shouldFocus: true });
      else if (e instanceof AppError && e.code === 'invalid_email') form.setError('email', { message: e.message }, { shouldFocus: true });
      else toast(e instanceof Error ? e.message : 'Something went wrong');
    }
  });

  return (
    <Screen header={<AppBar title="Forgot password" />}>
      <View style={{ paddingTop: space.s2, gap: space.s4 }}>
        <Text style={[type.body, { color: colors.ink }]}>Enter your username and the email on your account. We’ll email a code to that address.</Text>
        <FormInput
          form={form}
          name="username"
          label="Username"
          autoComplete="username"
          textContentType="username"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoFocus
        />
        <FormInput
          form={form}
          name="email"
          label="Email"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
        />
        <Button label="Send code" onPress={submit} busy={form.formState.isSubmitting} />
      </View>
    </Screen>
  );
}
