import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { FormInput } from '../../src/features/auth/FormInput';
import { forgotSchema, type ForgotInput } from '../../src/features/auth/schemas';
import { AppError } from '../../src/services/errors';
import { useServices } from '../../src/services/useServices';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AppBar } from '../../src/ui/AppBar';
import { Button } from '../../src/ui/Button';
import { Screen } from '../../src/ui/Screen';
import { toast } from '../../src/ui/Toast';

/** Forgot password, step 1 (specs § 4.5a): the username; the code goes to the email on that account. */
export default function Forgot() {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const form = useForm<ForgotInput>({ resolver: zodResolver(forgotSchema), mode: 'onTouched', defaultValues: { username: '' } });

  const submit = form.handleSubmit(async ({ username }) => {
    try {
      const { resetId, maskedEmail } = await services.auth.requestResetOtp(username);
      router.push({ pathname: '/forgot-otp', params: { resetId, maskedEmail } });
    } catch (e) {
      if (e instanceof AppError && e.code === 'unknown_username') form.setError('username', { message: e.message }, { shouldFocus: true });
      else toast(e instanceof Error ? e.message : 'Something went wrong');
    }
  });

  return (
    <Screen header={<AppBar title="Forgot password" />}>
      <View style={{ paddingTop: space.s2, gap: space.s4 }}>
        <Text style={[type.body, { color: colors.ink }]}>Enter your username. We’ll email a code to the address on your account.</Text>
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
        <Button label="Send code" onPress={submit} busy={form.formState.isSubmitting} />
      </View>
    </Screen>
  );
}
