import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { FormInput } from '../../src/features/auth/FormInput';
import { resetToken } from '../../src/features/auth/resetToken';
import { PASSWORD_HINT, resetSchema, type ResetInput } from '../../src/features/auth/schemas';
import { useServices } from '../../src/services/useServices';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AppBar } from '../../src/ui/AppBar';
import { Button } from '../../src/ui/Button';
import { Screen } from '../../src/ui/Screen';
import { toast } from '../../src/ui/Toast';

/** Forgot password, step 3 (specs § 4.5c): a new password; Save returns to Sign In with the username filled in. */
export default function Reset() {
  const { space } = useTheme();
  const services = useServices();
  const form = useForm<ResetInput>({ resolver: zodResolver(resetSchema), mode: 'onTouched', defaultValues: { password: '', confirm: '' } });
  const [token] = useState(resetToken.get); // read once: clearing it after Save must not bounce this screen while it slides away
  useEffect(() => () => resetToken.clear(), []); // leaving without saving drops the token
  if (!token) return <Redirect href="/forgot" />; // no verified code behind this screen (a web reload)

  const submit = form.handleSubmit(async ({ password }) => {
    try {
      const { username } = await services.auth.resetPassword(token, password);
      resetToken.clear();
      toast('Password updated');
      router.dismissTo({ pathname: '/signin', params: { username } }); // back to the Sign In the user came from
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong');
    }
  });

  return (
    <Screen header={<AppBar title="New password" />}>
      <View style={{ paddingTop: space.s2, gap: space.s4 }}>
        <FormInput
          form={form}
          name="password"
          password
          label="New password"
          helper={PASSWORD_HINT}
          autoComplete="new-password"
          textContentType="newPassword"
          revalidate={['confirm']}
          autoFocus
        />
        <FormInput form={form} name="confirm" password label="Confirm password" autoComplete="new-password" textContentType="newPassword" />
        <Button label="Save password" onPress={submit} busy={form.formState.isSubmitting} />
      </View>
    </Screen>
  );
}
